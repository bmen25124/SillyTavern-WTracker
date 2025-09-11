import React from 'react';
import { createRoot } from 'react-dom/client';
import { settingsManager, WTrackerSettings } from './components/Settings.js';

import { buildPrompt, Message, Generator } from 'sillytavern-utils-lib';
import { ChatMessage, EventNames, ExtractedData } from 'sillytavern-utils-lib/types';
import { characters, name1, selected_group, st_echo } from 'sillytavern-utils-lib/config';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import { ExtensionSettings, PromptEngineeringMode, EXTENSION_KEY, extensionName } from './config.js';
import { parseResponse } from './parser.js';
import { schemaToExample } from './schema-to-example.js';
import * as Handlebars from 'handlebars';
import { POPUP_RESULT, POPUP_TYPE } from 'sillytavern-utils-lib/types/popup';

// --- Constants and Globals ---
const CHAT_METADATA_SCHEMA_PRESET_KEY = 'schemaKey';
const CHAT_MESSAGE_SCHEMA_VALUE_KEY = 'value';
const CHAT_MESSAGE_SCHEMA_HTML_KEY = 'html';

const globalContext = SillyTavern.getContext();
const generator = new Generator();
const pendingRequests = new Map<number, string>();
const incomingTypes = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
const outgoingTypes = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];

// --- Handlebars Helper ---
if (!Handlebars.helpers['join']) {
  Handlebars.registerHelper('join', function (array: any, separator: any) {
    if (Array.isArray(array)) {
      return array.join(typeof separator === 'string' ? separator : ', ');
    }
    return '';
  });
}

// --- Core Logic Functions (ported from original index.ts) ---

function renderTracker(messageId: number) {
  const message = globalContext.chat[messageId];
  if (!message?.extra?.[EXTENSION_KEY]) return;

  const trackerData = message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY];
  const trackerHtmlSchema = message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_HTML_KEY];
  if (!trackerData || !trackerHtmlSchema) return;

  const messageBlock = document.querySelector(`.mes[mesid="${messageId}"]`);
  if (!messageBlock) return;

  messageBlock.querySelector('.mes_wtracker')?.remove();

  try {
    const template = Handlebars.compile(trackerHtmlSchema, { noEscape: true, strict: true });
    const renderedHtml = template({ data: trackerData });
    const container = document.createElement('div');
    container.className = 'mes_wtracker';
    container.innerHTML = renderedHtml;
    messageBlock.querySelector('.mes_text')?.before(container);
  } catch (error) {
    console.error('Error rendering WTracker template:', error);
    st_echo('error', 'Failed to render WTracker HTML. Check template syntax.');
  }
}

function includeWTrackerMessages<T extends Message | ChatMessage>(messages: T[], settings: ExtensionSettings): T[] {
  let copyMessages = structuredClone(messages);
  if (settings.includeLastXWTrackerMessages > 0) {
    for (let i = 0; i < settings.includeLastXWTrackerMessages; i++) {
      let foundMessage: T | null = null;
      let foundIndex = -1;
      for (let j = copyMessages.length - 2; j >= 0; j--) {
        // -2 to skip current message
        const message = copyMessages[j];
        const extra = 'source' in message ? (message as Message).source?.extra : (message as ChatMessage).extra;
        // @ts-ignore
        if (!message.wTrackerFound && extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY]) {
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
        const content = `Tracker:\n\`\`\`json\n${JSON.stringify(extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY] || '{}', null, 2)}\n\`\`\``;
        copyMessages.splice(foundIndex + 1, 0, {
          content,
          role: 'user',
          name: name1,
          is_user: true,
          mes: content,
          is_system: false,
        } as unknown as T);
      }
    }
  }
  return copyMessages;
}

async function generateTracker(id: number) {
  const message = globalContext.chat[id];
  if (!message) return st_echo('error', `Message with ID ${id} not found.`);

  if (pendingRequests.has(id)) {
    const requestId = pendingRequests.get(id)!;
    generator.abortRequest(requestId);
    st_echo('info', 'Tracker generation cancelled.');
    return;
  }

  const settings = settingsManager.getSettings();
  if (!settings.profileId) return st_echo('error', 'Please select a connection profile in settings.');
  const context = SillyTavern.getContext();
  const chatMetadata = context.chatMetadata;
  const { extensionSettings, CONNECT_API_MAP, saveChat } = globalContext;
  // Ensure chat metadata is initialized
  chatMetadata[EXTENSION_KEY] = chatMetadata[EXTENSION_KEY] || {};
  chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] =
    chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] || settings.schemaPreset;

  const chatJsonValue = settings.schemaPresets[settings.schemaPreset].value;
  const chatHtmlValue = settings.schemaPresets[settings.schemaPreset].html;

  const profile = extensionSettings.connectionManager?.profiles?.find((p) => p.id === settings.profileId);
  const apiMap = profile?.api ? CONNECT_API_MAP[profile.api] : null;
  let characterId = characters.findIndex((char: any) => char.avatar === message.original_avatar);
  characterId = characterId !== -1 ? characterId : undefined;

  const currentButton = document.querySelector(`.mes[mesid="${id}"] .mes_wtracker_button`);
  try {
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
    let messages = includeWTrackerMessages(promptResult.result, settings);
    let response: ExtractedData['content'];

    const makeRequest = (requestMessages: Message[], customParams?: any): Promise<ExtractedData | undefined> => {
      return new Promise((resolve, reject) => {
        const abortController = new AbortController();
        generator.generateRequest(
          {
            profileId: settings.profileId,
            prompt: requestMessages,
            maxTokens: settings.maxResponseToken,
            custom: { ...customParams, signal: abortController.signal },
          },
          {
            abortController,
            onStart: (requestId) => {
              pendingRequests.set(id, requestId);
            },
            onFinish: (data, error) => {
              pendingRequests.delete(id);
              if (error) {
                return reject(error);
              }
              if (!data) {
                // This is how Generator signals cancellation without an error object
                return reject(new DOMException('Request aborted by user', 'AbortError'));
              }
              resolve(data as ExtractedData | undefined);
            },
          },
        );
      });
    };

    if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
      messages.push({ content: settings.prompt, role: 'user' });
      const result = await makeRequest(messages, {
        json_schema: { name: 'SceneTracker', strict: true, value: chatJsonValue },
      });
      // @ts-ignore
      response = result?.content;
    } else {
      const format = settings.promptEngineeringMode as 'json' | 'xml';
      const promptTemplate = format === 'json' ? settings.promptJson : settings.promptXml;
      const exampleResponse = schemaToExample(chatJsonValue, format);
      const finalPrompt = Handlebars.compile(promptTemplate, { noEscape: true, strict: true })({
        schema: JSON.stringify(chatJsonValue, null, 2),
        example_response: exampleResponse,
      });
      messages.push({ content: finalPrompt, role: 'user' });
      const rest = await makeRequest(messages);
      if (!rest?.content) throw new Error('No response content received.');
      // @ts-ignore
      response = parseResponse(rest.content, format, { schema: chatJsonValue });
    }

    if (!response || Object.keys(response as any).length === 0) throw new Error('Empty response from WTracker.');

    message.extra = message.extra || {};
    message.extra[EXTENSION_KEY] = message.extra[EXTENSION_KEY] || {};
    message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY] = response;
    message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_HTML_KEY] = chatHtmlValue;

    await saveChat();
    renderTracker(id);
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      console.error('Error generating tracker:', error);
      st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
    }
  } finally {
    currentButton?.classList.remove('spinning');
  }
}

// --- UI Initialization (Non-React parts) ---

async function initializeGlobalUI() {
  // Add WTracker icon to message buttons
  const wTrackerIcon = document.createElement('div');
  wTrackerIcon.title = 'WTracker';
  wTrackerIcon.className = 'mes_button mes_wtracker_button fa-solid fa-truck-moving interactable';
  wTrackerIcon.tabIndex = 0;
  document.querySelector('#message_template .mes_buttons .extraMesButtons')?.prepend(wTrackerIcon);

  // Add global click listener for the tracker button on messages
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.classList.contains('mes_wtracker_button')) {
      const messageId = Number(target.closest('.mes')?.getAttribute('mesid'));
      if (!isNaN(messageId)) generateTracker(messageId);
    }
  });

  const extensionsMenu = document.querySelector('#extensionsMenu');
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'wtracker_menu_buttons';
  buttonContainer.className = 'extension_container';
  extensionsMenu?.appendChild(buttonContainer);
  const buttonHtml = await globalContext.renderExtensionTemplateAsync(
    `third-party/${extensionName}`,
    'templates/buttons',
  );
  buttonContainer.insertAdjacentHTML('beforeend', buttonHtml);
  extensionsMenu?.querySelector('#wtracker_modify_schema_preset')?.addEventListener('click', async () => {
    await modifyChatMetadata();
  });

  // Set up event listeners for auto-mode and chat changes
  const settings = settingsManager.getSettings();
  globalContext.eventSource.on(
    EventNames.CHARACTER_MESSAGE_RENDERED,
    (messageId: number) => incomingTypes.includes(settings.autoMode) && generateTracker(messageId),
  );
  globalContext.eventSource.on(
    EventNames.USER_MESSAGE_RENDERED,
    (messageId: number) => outgoingTypes.includes(settings.autoMode) && generateTracker(messageId),
  );
  globalContext.eventSource.on(EventNames.CHAT_CHANGED, () => globalContext.chat.forEach((_, i) => renderTracker(i)));

  // Register the global generation interceptor
  (globalThis as any).wtrackerGenerateInterceptor = (chat: ChatMessage[]) => {
    const newChat = includeWTrackerMessages(chat, settingsManager.getSettings());
    chat.length = 0;
    chat.push(...newChat);
  };
}

async function modifyChatMetadata() {
  const settings = settingsManager.getSettings();
  const context = SillyTavern.getContext();
  const chatMetadata = context.chatMetadata;
  if (!chatMetadata[EXTENSION_KEY]) {
    chatMetadata[EXTENSION_KEY] = {};
  }
  if (!chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY]) {
    chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] = 'default';
    context.saveMetadataDebounced();
  }
  const currentPresetKey = chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY];

  // Prepare data for the Handlebars template
  const templateData = {
    presets: Object.entries(settings.schemaPresets).map(([key, preset]) => ({
      key: key,
      name: preset.name,
      selected: key === currentPresetKey,
    })),
  };

  // Render the popup content from the template file
  const popupContent = await globalContext.renderExtensionTemplateAsync(
    'third-party/SillyTavern-WTracker',
    'templates/modify_schema_popup',
    templateData,
  );

  await globalContext.callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, '', {
    okButton: 'Save',
    onClose(popup) {
      if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
        const selectElement = document.getElementById('wtracker-chat-schema-select') as HTMLSelectElement;
        if (selectElement) {
          const newPresetKey = selectElement.value;
          if (newPresetKey !== currentPresetKey) {
            chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] = newPresetKey;
            context.saveMetadataDebounced();
            st_echo('success', `Chat schema preset updated to "${settings.schemaPresets[newPresetKey].name}".`);
          }
        }
      }
    },
  });
}

// --- Main Application Entry ---

function renderReactSettings() {
  const settingsContainer = document.getElementById('extensions_settings');
  if (!settingsContainer) {
    console.error('WTracker: Extension settings container not found.');
    return;
  }

  let reactRootEl = document.getElementById('wtracker-react-settings-root');
  if (!reactRootEl) {
    reactRootEl = document.createElement('div');
    reactRootEl.id = 'wtracker-react-settings-root';
    settingsContainer.appendChild(reactRootEl);
  }

  const root = createRoot(reactRootEl);
  root.render(
    <React.StrictMode>
      <WTrackerSettings />
    </React.StrictMode>,
  );
}

function main() {
  renderReactSettings();
  initializeGlobalUI();
}

settingsManager
  .initializeSettings()
  .then(main)
  .catch((error) => {
    console.error(error);
    st_echo('error', 'WTracker data migration failed. Check console for details.');
  });
