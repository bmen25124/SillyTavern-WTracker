import { buildPresetSelect, buildPrompt, ExtensionSettingsManager, Message } from 'sillytavern-utils-lib';
import { ChatMessage, EventNames, ExtractedData } from 'sillytavern-utils-lib/types';
import { characters, name1, selected_group, st_echo } from 'sillytavern-utils-lib/config';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import { DEFAULT_PROMPT, DEFAULT_SCHEMA_HTML, DEFAULT_SCHEMA_VALUE, ExtensionSettings } from './config.js';
import { POPUP_RESULT } from 'sillytavern-utils-lib/types/popup';

import * as Handlebars from 'handlebars';

if (!Handlebars.helpers['join']) {
  Handlebars.registerHelper('join', function (array: any, separator: any) {
    if (Array.isArray(array)) {
      return array.join(typeof separator === 'string' ? separator : ', ');
    }
    return '';
  });
}

const VERSION = '0.1.0';
const FORMAT_VERSION = 'F_1.0';

const defaultSettings: ExtensionSettings = {
  version: VERSION,
  formatVersion: FORMAT_VERSION,
  profileId: '',
  maxResponseToken: 16000,
  autoMode: AutoModeOptions.NONE,
  schemaPreset: 'default',
  schemaPresets: {
    default: {
      name: 'Default',
      value: DEFAULT_SCHEMA_VALUE,
      html: DEFAULT_SCHEMA_HTML,
    },
  },
  prompt: DEFAULT_PROMPT,
  includeLastXMessages: 0,
  includeLastXWTrackerMessages: 1,
};

// Keys for extension settings
const EXTENSION_KEY = 'WTracker';
const CHAT_METADATA_SCHEMA_VALUE_KEY = 'schemaValue';
const CHAT_METADATA_SCHEMA_HTML_KEY = 'schemaHtml';
const CHAT_MESSAGE_SCHEMA_VALUE_KEY = 'value';
const CHAT_MESSAGE_SCHEMA_HTML_KEY = 'html';

const globalContext = SillyTavern.getContext();
const settingsManager = new ExtensionSettingsManager<ExtensionSettings>(EXTENSION_KEY, defaultSettings);

const incomingTypes = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
const outgoingTypes = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];

function renderTracker(messageId: number) {
  const context = SillyTavern.getContext();
  const message = context.chat[messageId];
  if (!message || !message.extra || !message.extra[EXTENSION_KEY]) {
    return;
  }

  const trackerData = message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY];
  const trackerHtmlSchema = message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_HTML_KEY];

  if (!trackerData || !trackerHtmlSchema) {
    return;
  }

  const messageBlock = document.querySelector(`.mes[mesid="${messageId}"]`);
  if (!messageBlock) {
    return;
  }

  const existingRender = messageBlock.querySelector('.mes_wtracker');
  if (existingRender) {
    existingRender.remove();
  }

  try {
    const template = Handlebars.compile(trackerHtmlSchema);
    const renderedHtml = template({ data: trackerData });

    const mesText = messageBlock.querySelector('.mes_text');
    if (mesText) {
      const container = document.createElement('div');
      container.className = 'mes_wtracker';
      container.innerHTML = renderedHtml;
      mesText.before(container);
    }
  } catch (error) {
    console.error('Error rendering WTracker template:', error);
    st_echo('error', 'Failed to render WTracker HTML. Check template syntax.');
  }
}

function includeWTrackerMessages<T extends Message | ChatMessage>(messages: T[], settings: ExtensionSettings): T[] {
  if (settings.includeLastXWTrackerMessages > 0) {
    for (let i = 0; i < settings.includeLastXWTrackerMessages; i++) {
      let foundMessage: T | null = null;
      let foundIndex = -1;
      for (let j = messages.length - 1 - 1; j >= 0; j--) {
        // Additional -1 means, we skip the current message
        const message = messages[j];
        const extra = 'source' in message ? (message as Message).source?.extra : (message as ChatMessage).extra;
        if (
          // @ts-ignore
          !message.wTrackerFound &&
          extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY]
        ) {
          // @ts-ignore
          message.wTrackerFound = true;
          foundMessage = message;
          foundIndex = j;
          break;
        }
      }
      if (foundMessage) {
        const extra =
          'source' in foundMessage ? (foundMessage as Message).source?.extra : (foundMessage as ChatMessage).extra;
        const content = `Tracker:
\`\`\`json
${JSON.stringify(extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY] || '{}', null, 2)}
\`\`\`
`;
        const newMessages = [
          ...messages.slice(0, foundIndex + 1),
          {
            content,
            role: 'user',
            name: name1,
            is_user: true,
            mes: content,
            is_system: false,
          } as unknown as T,
          ...messages.slice(foundIndex + 1),
        ];
        messages = newMessages;
      }
    }
  }
  return messages;
}

async function initUI() {
  // Render and append settings UI
  const settingsHtml = await globalContext.renderExtensionTemplateAsync(
    `third-party/SillyTavern-WTracker`,
    'templates/settings',
    {},
  );
  const extensionsSettings = document.getElementById('extensions_settings');
  if (extensionsSettings) {
    extensionsSettings.insertAdjacentHTML('beforeend', settingsHtml);
  }

  // Initialize settings UI
  await initSettingsUI();

  // WTracker icon to message buttons
  const wTrackerIcon = document.createElement('div');
  wTrackerIcon.title = 'WTracker';
  wTrackerIcon.className = 'mes_button mes_wtracker_button fa-solid fa-truck-moving interactable';
  wTrackerIcon.tabIndex = 0;
  const messageTemplate = document.querySelector('#message_template .mes_buttons .extraMesButtons');
  if (messageTemplate) {
    messageTemplate.prepend(wTrackerIcon);
  }

  document.addEventListener('click', async function (event) {
    const target = event.target as HTMLElement;
    if (target.classList.contains('mes_wtracker_button')) {
      const messageBlock = target.closest('.mes');
      if (messageBlock) {
        const messageId = Number(messageBlock.getAttribute('mesid'));
        await generateTracker(messageId);
      }
    }
  });

  // Event listeners for message rendering
  const settings = settingsManager.getSettings();

  // @ts-ignore
  globalContext.eventSource.makeFirst(EventNames.CHARACTER_MESSAGE_RENDERED, async (messageId: number) => {
    if (incomingTypes.includes(settings.autoMode)) {
      await generateTracker(messageId);
    }
  });

  // @ts-ignore
  globalContext.eventSource.makeFirst(EventNames.USER_MESSAGE_RENDERED, async (messageId: number) => {
    if (outgoingTypes.includes(settings.autoMode)) {
      await generateTracker(messageId);
    }
  });

  globalContext.eventSource.on(EventNames.CHAT_CHANGED, () => {
    const context = SillyTavern.getContext();
    for (let i = 0; i < context.chat.length; i++) {
      renderTracker(i);
    }
  });

  // @ts-ignore
  globalThis.wtrackerGenerateInterceptor = async function (chat: ChatMessage[]) {
    const settings = settingsManager.getSettings();
    const newChat = includeWTrackerMessages(chat, settings);

    // Reassign
    chat.length = 0;
    chat.push(...newChat);
  };

  // Modify schema of current chat
  const extensionsMenu = document.querySelector('#extensionsMenu');
  const wTrackerWandContainer = document.createElement('div');
  wTrackerWandContainer.id = 'wtracker_wand_container';
  wTrackerWandContainer.className = 'extension_container';
  extensionsMenu?.appendChild(wTrackerWandContainer);
  const buttonHtml = await globalContext.renderExtensionTemplateAsync(
    'third-party/SillyTavern-WTracker',
    'templates/buttons',
  );
  wTrackerWandContainer.insertAdjacentHTML('beforeend', buttonHtml);

  extensionsMenu?.querySelector('#wtracker_modify_schema')?.addEventListener('click', async () => {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata) {
      return;
    }
    if (!context.chatMetadata[EXTENSION_KEY]) {
      context.chatMetadata[EXTENSION_KEY] = {};
      context.saveMetadataDebounced();
    }
    if (!context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY]) {
      if (!settings.schemaPreset) {
        await st_echo('error', 'Chat metadata schema is not set. Please select a schema preset first in the settings.');
        return;
      } else {
        context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY] =
          settings.schemaPresets[settings.schemaPreset].value;
        context.saveMetadataDebounced();
      }
    }
    const chatJsonValue = context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY];
    await globalContext.Popup.show.input(
      'Modify WTracker Schema',
      'Enter the new schema value in JSON format:',
      JSON.stringify(chatJsonValue, null, 2),
      {
        wider: true,
        large: true,
        rows: 16,
        onClose(popup) {
          const result = popup.result as POPUP_RESULT;
          if (result === POPUP_RESULT.AFFIRMATIVE) {
            try {
              const newValue = JSON.parse(popup.mainInput.value);
              context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY] = newValue;
              context.saveMetadataDebounced();
              st_echo('success', 'Schema value updated successfully.');
            } catch (error) {
              st_echo('error', 'Invalid JSON format. Please check your input.');
              console.error('Invalid JSON:', error);
              context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY] = chatJsonValue;
              context.saveMetadataDebounced();
            }
          }
        },
        onClosing(popup) {
          const result = popup.result as POPUP_RESULT;
          if (result === POPUP_RESULT.AFFIRMATIVE) {
            try {
              JSON.parse(popup.mainInput.value);
              return true; // Allow closing
            } catch (error) {
              st_echo('error', 'Invalid JSON format. Please check your input.');
              console.error('Invalid JSON:', error);
              return false; // Prevent closing
            }
          }
          return true; // Allow closing for other results
        },
      },
    );
  });

  // Modify schema HTML of current chat
  extensionsMenu?.querySelector('#wtracker_modify_html')?.addEventListener('click', async () => {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata) {
      return;
    }
    if (!context.chatMetadata[EXTENSION_KEY]) {
      context.chatMetadata[EXTENSION_KEY] = {};
      context.saveMetadataDebounced();
    }
    if (!context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_HTML_KEY]) {
      if (!settings.schemaPreset) {
        await st_echo(
          'error',
          'Chat metadata schema HTML is not set. Please select a schema preset first in the settings.',
        );
        return;
      } else {
        context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_HTML_KEY] =
          settings.schemaPresets[settings.schemaPreset].html;
        context.saveMetadataDebounced();
      }
    }
    const chatHtmlValue = context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_HTML_KEY];
    await globalContext.Popup.show.input(
      'Modify WTracker Schema HTML',
      'Enter the new schema HTML value:',
      chatHtmlValue,
      {
        wider: true,
        large: true,
        rows: 16,
        onClose(popup) {
          const result = popup.result as POPUP_RESULT;
          if (result === POPUP_RESULT.AFFIRMATIVE) {
            context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_HTML_KEY] = popup.mainInput.value;
            context.saveMetadataDebounced();
            st_echo('success', 'Schema HTML updated successfully.');
          }
        },
      },
    );
  });
}

async function initSettingsUI() {
  const settingsContainer = document.querySelector('.wtracker-settings');
  if (!settingsContainer) {
    console.error('Settings container not found');
    return;
  }

  const settings = settingsManager.getSettings();

  // Connection Profile
  globalContext.ConnectionManagerRequestService.handleDropdown(
    '#wtracker_connection_profile',
    settings.profileId,
    (profile) => {
      settings.profileId = profile?.id ?? '';
      settingsManager.saveSettings();
    },
  );

  // Auto Mode
  const autoModeSelect = settingsContainer.querySelector('#wtracker_auto_mode') as HTMLSelectElement;
  autoModeSelect.value = settings.autoMode;
  autoModeSelect.addEventListener('change', () => {
    settings.autoMode = autoModeSelect.value as AutoModeOptions;
    settingsManager.saveSettings();
  });

  // Schema Presets
  const schemaPresetSelect = settingsContainer.querySelector('#wtracker_schema_preset') as HTMLSelectElement;
  const schemaTextArea = settingsContainer.querySelector('#wtracker_schema') as HTMLTextAreaElement;
  const schemaHtmlTextArea = settingsContainer.querySelector('#wtracker_schema_html') as HTMLTextAreaElement;
  schemaPresetSelect.value = settings.schemaPreset;
  schemaTextArea.value = JSON.stringify(settings.schemaPresets[settings.schemaPreset].value, null, 2);
  schemaHtmlTextArea.value = settings.schemaPresets[settings.schemaPreset].html;
  buildPresetSelect('#wtracker_schema_preset', {
    initialList: Object.entries(settings.schemaPresets).map(([name, preset]) => ({
      label: preset.name,
      value: name,
    })),
    readOnlyValues: ['default'],
    onSelectChange: async (_previousValue, newValue) => {
      const newPresetValue = newValue ?? 'default';
      const preset = settings.schemaPresets[newPresetValue];
      settings.schemaPreset = newPresetValue;

      schemaTextArea.value = JSON.stringify(preset.value, null, 2);
      schemaHtmlTextArea.value = preset.html;

      settingsManager.saveSettings();
    },
    create: {
      onAfterCreate: (value) => {
        settings.schemaPresets[globalContext.uuidv4()] = {
          name: value,
          value: settings.schemaPresets[schemaPresetSelect.value].value,
          html: DEFAULT_SCHEMA_HTML,
        };
      },
    },
    rename: {
      onAfterRename: (_previousValue, newValue) => {
        settings.schemaPresets[schemaPresetSelect.value].name = newValue;
      },
    },
    delete: {
      onAfterDelete: (value) => {
        delete settings.schemaPresets[value];
      },
    },
  });

  // Restore default schema
  const restoreDefaultButton = settingsContainer.querySelector(
    '.wtracker_schema_preset_restore_default',
  ) as HTMLButtonElement;
  restoreDefaultButton.addEventListener('click', () => {
    schemaTextArea.value = JSON.stringify(DEFAULT_SCHEMA_VALUE, null, 2);
    schemaHtmlTextArea.value = DEFAULT_SCHEMA_HTML;
    schemaPresetSelect.value = 'default';

    schemaHtmlTextArea.dispatchEvent(new Event('change'));
    schemaTextArea.dispatchEvent(new Event('change'));
    schemaPresetSelect.dispatchEvent(new Event('change'));
  });

  // Schema Text Area
  schemaTextArea.addEventListener('change', () => {
    try {
      const value = JSON.parse(schemaTextArea.value);
      settings.schemaPresets[schemaPresetSelect.value].value = value;
    } catch (error) {
      st_echo('error', 'Invalid JSON format in schema text area');
      console.error('Invalid JSON:', error);
    }
  });
  // Schema HTML Text Area
  schemaHtmlTextArea.addEventListener('change', () => {
    settings.schemaPresets[schemaPresetSelect.value].html = schemaHtmlTextArea.value;
    settingsManager.saveSettings();
  });

  // Prompt Text Area
  const promptTextArea = settingsContainer.querySelector('#wtracker_prompt') as HTMLTextAreaElement;
  promptTextArea.value = settings.prompt;
  promptTextArea.addEventListener('change', () => {
    settings.prompt = promptTextArea.value;
    settingsManager.saveSettings();
  });
  // Restore default prompt
  const restorePromptButton = settingsContainer.querySelector('.prompt_restore_default') as HTMLButtonElement;
  restorePromptButton.addEventListener('click', () => {
    promptTextArea.value = DEFAULT_PROMPT;
    settings.prompt = DEFAULT_PROMPT;
    settingsManager.saveSettings();
  });

  // Max Response Tokens
  const maxResponseTokensInput = settingsContainer.querySelector('#wtracker_max_response_tokens') as HTMLInputElement;
  maxResponseTokensInput.value = settings.maxResponseToken.toString();
  maxResponseTokensInput.addEventListener('input', () => {
    const value = parseInt(maxResponseTokensInput.value, 10);
    if (!isNaN(value) && value > 0) {
      settings.maxResponseToken = value;
      settingsManager.saveSettings();
    } else {
      st_echo('error', 'Max response tokens must be a positive integer');
      maxResponseTokensInput.value = settings.maxResponseToken.toString();
    }
  });

  // Include Last X Messages
  const includeLastXMessagesInput = settingsContainer.querySelector(
    '#wtracker_include_last_x_messages',
  ) as HTMLInputElement;
  includeLastXMessagesInput.value = settings.includeLastXMessages.toString();
  includeLastXMessagesInput.addEventListener('input', () => {
    const value = parseInt(includeLastXMessagesInput.value, 10);
    if (!isNaN(value) && value >= 0) {
      settings.includeLastXMessages = value;
      settingsManager.saveSettings();
    } else {
      st_echo('error', 'Include last X messages must be a non-negative integer');
      includeLastXMessagesInput.value = settings.includeLastXMessages.toString();
    }
  });

  // Include Last X WTracker Messages
  const includeLastXWTrackerMessagesInput = settingsContainer.querySelector(
    '#wtracker_include_last_x_wtracker_messages',
  ) as HTMLInputElement;
  includeLastXWTrackerMessagesInput.value = settings.includeLastXWTrackerMessages.toString();
  includeLastXWTrackerMessagesInput.addEventListener('input', () => {
    const value = parseInt(includeLastXWTrackerMessagesInput.value, 10);
    if (!isNaN(value) && value >= 0) {
      settings.includeLastXWTrackerMessages = value;
      settingsManager.saveSettings();
    } else {
      st_echo('error', 'Include last X WTracker messages must be a non-negative integer');
      includeLastXWTrackerMessagesInput.value = settings.includeLastXWTrackerMessages.toString();
    }
  });

  // Reset Button
  const resetButton = settingsContainer.querySelector('#wtracker_reset_button') as HTMLButtonElement;
  if (resetButton) {
    resetButton.addEventListener('click', async () => {
      const confirmed = await globalContext.Popup.show.confirm(
        'Reset Settings',
        'This will reset all WTracker settings to their default values. Are you sure?',
      );

      if (confirmed) {
        await resetSettingsToDefaults();
      }
    });
  }
}

async function resetSettingsToDefaults() {
  // Reset settings to defaults
  settingsManager.resetSettings();

  // Refresh the UI with default values
  const settingsContainer = document.querySelector('.wtracker-settings');
  if (!settingsContainer) return;

  const settings = settingsManager.getSettings();

  // Update all UI elements with default values
  const autoModeSelect = settingsContainer.querySelector('#wtracker_auto_mode') as HTMLSelectElement;
  autoModeSelect.value = settings.autoMode;

  st_echo('info', 'Settings have been reset to defaults');
}

const pendingRequests = new Set<number>();

async function generateTracker(id: number) {
  const message = SillyTavern.getContext().chat[id];
  if (!message) {
    st_echo('error', `Message with ID ${id} not found.`);
    return;
  }
  const settings = settingsManager.getSettings();
  if (!settings.profileId) {
    await st_echo('error', 'Please select a connection profile first in the settings.');
    return;
  }

  const context = SillyTavern.getContext();
  // Ensure chat metadata schema is set
  if (!context.chatMetadata[EXTENSION_KEY]) {
    context.chatMetadata[EXTENSION_KEY] = {};
    context.saveMetadataDebounced();
  }
  if (!context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY]) {
    if (!settings.schemaPreset) {
      await st_echo('error', 'Chat metadata schema is not set. Please select a schema preset first in the settings.');
      return;
    } else {
      context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY] =
        settings.schemaPresets[settings.schemaPreset].value;
      context.saveMetadataDebounced();
    }
  }
  if (!context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_HTML_KEY]) {
    if (!settings.schemaPreset) {
      await st_echo(
        'error',
        'Chat metadata schema HTML is not set. Please select a schema preset first in the settings.',
      );
      return;
    } else {
      context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_HTML_KEY] =
        settings.schemaPresets[settings.schemaPreset].html;
      context.saveMetadataDebounced();
    }
  }
  const chatJsonValue = context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY];
  const chatHtmlValue = context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_HTML_KEY];

  const profile = context.extensionSettings.connectionManager?.profiles?.find(
    (profile) => profile.id === settings.profileId,
  );

  const apiMap = profile?.api ? context.CONNECT_API_MAP[profile.api] : null;
  const targetMessage = context.chat.find((_mes, index) => index === id);
  if (!targetMessage) {
    return;
  }
  let characterId: number | undefined = characters.findIndex(
    (char: any) => char.avatar === targetMessage.original_avatar,
  );
  characterId = characterId !== -1 ? characterId : undefined;

  const currentButton = document.querySelector(`.mes[mesid="${id}"] .mes_wtracker_button`);
  try {
    if (pendingRequests.has(id)) {
      await st_echo('warning', 'A request for this message is already in progress. Please wait.');
      return;
    }
    pendingRequests.add(id);
    currentButton?.classList.add('spinning');

    const promptResult = await buildPrompt(apiMap?.selected!, {
      targetCharacterId: characterId,
      messageIndexesBetween: {
        end: id,
        start: settings.includeLastXMessages > 0 ? Math.max(0, id - settings.includeLastXMessages) : 0,
      },
      presetName: profile?.preset,
      contextName: profile?.context,
      instructName: profile?.instruct,
      syspromptName: profile?.sysprompt,
      includeNames: !!selected_group,
    });
    let messages = promptResult.result;
    messages = includeWTrackerMessages(messages, settings);

    messages.push({
      content: settings.prompt,
      role: 'user',
    });
    const rest = (await context.ConnectionManagerRequestService.sendRequest(
      settings.profileId,
      messages,
      settings.maxResponseToken,
      {},
      {
        json_schema: { name: 'SceneTracker', strict: true, value: chatJsonValue },
        temperature: 0.8,
      },
    )) as ExtractedData;
    if (!rest.content || Object.keys(rest.content as any).length === 0) {
      await st_echo('error', 'No response received from WTracker.');
      return;
    }
    console.log('Response from WTracker:', rest);

    if (!message.extra) {
      message.extra = {};
    }
    if (!message.extra[EXTENSION_KEY]) {
      message.extra[EXTENSION_KEY] = {};
    }
    message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY] = rest.content;
    message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_HTML_KEY] = chatHtmlValue;
    await globalContext.saveChat();
    renderTracker(id);
  } catch (error) {
    console.error('Error generating tracker:', error);
    st_echo('error', 'An error occurred while generating the tracker.');
  } finally {
    pendingRequests.delete(id);
    currentButton?.classList.remove('spinning');
  }
}

function main() {
  initUI();
}

settingsManager
  .initializeSettings()
  .then((_result) => {
    main();
  })
  .catch((error) => {
    st_echo('error', error);
    globalContext.Popup.show
      .confirm('Data migration failed. Do you want to reset the WTracker data?', 'Reset WTracker Data')
      .then((result: any) => {
        if (result) {
          settingsManager.resetSettings();
          main();
        }
      });
  });
