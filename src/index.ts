import { buildPresetSelect, buildPrompt, ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { EventNames, ExtractedData } from 'sillytavern-utils-lib/types';
import { characters, selected_group, st_echo } from 'sillytavern-utils-lib/config';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import { DEFAULT_PROMPT, DEFAULT_SCHEMA_VALUE, ExtensionSettings } from './config.js';
import { POPUP_RESULT } from 'sillytavern-utils-lib/types/popup';

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
    },
  },
  prompt: DEFAULT_PROMPT,
};

// Keys for extension settings
const EXTENSION_KEY = 'WTracker';
const CHAT_METADATA_SCHEMA_VALUE_KEY = 'schemaValue';

const globalContext = SillyTavern.getContext();
const settingsManager = new ExtensionSettingsManager<ExtensionSettings>(EXTENSION_KEY, defaultSettings);

const incomingTypes = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
const outgoingTypes = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];

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
  wTrackerIcon.className = 'mes_button mes_wtracker_button fa-solid fa-train-tunnel interactable';
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
  schemaPresetSelect.value = settings.schemaPreset;
  schemaTextArea.value = JSON.stringify(settings.schemaPresets[settings.schemaPreset].value, null, 2);
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

      settingsManager.saveSettings();
    },
    create: {
      onAfterCreate: (value) => {
        settings.schemaPresets[globalContext.uuidv4()] = {
          name: value,
          value: {},
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
  const restoreDefaultButton = settingsContainer.querySelector('.restore_default') as HTMLButtonElement;
  restoreDefaultButton.addEventListener('click', () => {
    schemaTextArea.value = JSON.stringify(DEFAULT_SCHEMA_VALUE, null, 2);
    settingsManager.saveSettings();
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

  // Prompt Text Area
  const promptTextArea = settingsContainer.querySelector('#wtracker_prompt') as HTMLTextAreaElement;
  promptTextArea.value = settings.prompt;
  promptTextArea.addEventListener('change', () => {
    settings.prompt = promptTextArea.value;
    settingsManager.saveSettings();
  });
  // Restore default prompt
  const restorePromptButton = settingsContainer.querySelector('.restore_default') as HTMLButtonElement;
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
  const chatJsonValue = context.chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY];

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
      },
      presetName: profile?.preset,
      contextName: profile?.context,
      instructName: profile?.instruct,
      syspromptName: profile?.sysprompt,
      includeNames: !!selected_group,
    });
    const messages = promptResult.result;
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
    console.log('Response from WTracker:', rest);
  } catch (error) {
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
