import React from 'react';
import { createRoot } from 'react-dom/client';
import { settingsManager, WTrackerSettings } from './components/Settings.js';

import { buildPrompt, ExtensionSettingsManager, Message } from 'sillytavern-utils-lib';
import { ChatMessage, EventNames, ExtractedData } from 'sillytavern-utils-lib/types';
import { characters, name1, selected_group, st_echo } from 'sillytavern-utils-lib/config';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import { ExtensionSettings, PromptEngineeringMode, defaultSettings, EXTENSION_KEY } from './config.js';
import { parseResponse } from './parser.js';
import { schemaToExample } from './schema-to-example.js';
import * as Handlebars from 'handlebars';

// --- Constants and Globals ---
const CHAT_METADATA_SCHEMA_VALUE_KEY = 'schemaValue';
const CHAT_METADATA_SCHEMA_HTML_KEY = 'schemaHtml';
const CHAT_MESSAGE_SCHEMA_VALUE_KEY = 'value';
const CHAT_MESSAGE_SCHEMA_HTML_KEY = 'html';

const globalContext = SillyTavern.getContext();
const pendingRequests = new Set<number>();
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
    const template = Handlebars.compile(trackerHtmlSchema, { noEscape: true });
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
  if (pendingRequests.has(id)) return st_echo('warning', 'A request is already in progress.');

  const settings = settingsManager.getSettings();
  if (!settings.profileId) return st_echo('error', 'Please select a connection profile in settings.');

  const { chatMetadata, extensionSettings, CONNECT_API_MAP, ConnectionManagerRequestService, saveChat } = globalContext;

  // Ensure chat metadata is initialized
  chatMetadata[EXTENSION_KEY] = chatMetadata[EXTENSION_KEY] || {};
  chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY] =
    chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY] || settings.schemaPresets[settings.schemaPreset].value;
  chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_HTML_KEY] =
    chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_HTML_KEY] || settings.schemaPresets[settings.schemaPreset].html;

  const chatJsonValue = chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_VALUE_KEY];
  const chatHtmlValue = chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_HTML_KEY];

  const profile = extensionSettings.connectionManager?.profiles?.find((p) => p.id === settings.profileId);
  const apiMap = profile?.api ? CONNECT_API_MAP[profile.api] : null;
  let characterId = characters.findIndex((char: any) => char.avatar === message.original_avatar);
  characterId = characterId !== -1 ? characterId : undefined;

  const currentButton = document.querySelector(`.mes[mesid="${id}"] .mes_wtracker_button`);
  try {
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
    let messages = includeWTrackerMessages(promptResult.result, settings);
    let response: ExtractedData['content'];

    if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
      messages.push({ content: settings.prompt, role: 'user' });
      response = (
        (await ConnectionManagerRequestService.sendRequest(
          settings.profileId,
          messages,
          settings.maxResponseToken,
          {},
          {
            json_schema: { name: 'SceneTracker', strict: true, value: chatJsonValue },
            temperature: 0.8,
          },
        )) as ExtractedData
      ).content;
    } else {
      const format = settings.promptEngineeringMode as 'json' | 'xml';
      const promptTemplate = format === 'json' ? settings.promptJson : settings.promptXml;
      const exampleResponse = schemaToExample(chatJsonValue, format);
      const finalPrompt = Handlebars.compile(promptTemplate)({
        schema: JSON.stringify(chatJsonValue, null, 2),
        example_response: exampleResponse,
      });
      messages.push({ content: finalPrompt, role: 'user' });
      const rest = (await ConnectionManagerRequestService.sendRequest(
        settings.profileId,
        messages,
        settings.maxResponseToken,
        {},
        { temperature: 0.8 },
      )) as ExtractedData;
      if (!rest.content) throw new Error('No response content received.');
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
  } catch (error) {
    console.error('Error generating tracker:', error);
    st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
  } finally {
    pendingRequests.delete(id);
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

  // Add buttons to the main extensions menu for schema/HTML modification
  const extensionsMenu = document.querySelector('#extensionsMenu');
  const buttonHtml = await globalContext.renderExtensionTemplateAsync(
    'third-party/SillyTavern-WTracker',
    'templates/buttons',
  );
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'wtracker_menu_buttons';
  buttonContainer.innerHTML = buttonHtml;
  extensionsMenu?.appendChild(buttonContainer);

  buttonContainer
    .querySelector('#wtracker_modify_schema')
    ?.addEventListener('click', () => modifyChatMetadata('schema'));
  buttonContainer.querySelector('#wtracker_modify_html')?.addEventListener('click', () => modifyChatMetadata('html'));

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

// Helper for schema/HTML modification popups
async function modifyChatMetadata(type: 'schema' | 'html') {
  const { chatMetadata, saveMetadataDebounced, Popup } = globalContext;
  if (!chatMetadata) return;

  chatMetadata[EXTENSION_KEY] = chatMetadata[EXTENSION_KEY] || {};

  const isSchema = type === 'schema';
  const key = isSchema ? CHAT_METADATA_SCHEMA_VALUE_KEY : CHAT_METADATA_SCHEMA_HTML_KEY;
  const title = isSchema ? 'Modify WTracker Schema' : 'Modify WTracker Schema HTML';
  const settings = settingsManager.getSettings();
  const defaultValue = settings.schemaPresets[settings.schemaPreset][isSchema ? 'value' : 'html'];

  let currentValue = chatMetadata[EXTENSION_KEY][key] || defaultValue;
  if (isSchema && typeof currentValue !== 'string') {
    currentValue = JSON.stringify(currentValue, null, 2);
  }

  const popupResult = await Popup.show.input(title, '', currentValue, { wider: true, large: true, rows: 16 });

  if (popupResult) {
    let newValue: any = popupResult;
    if (isSchema) {
      try {
        newValue = JSON.parse(popupResult);
      } catch (err) {
        return st_echo('error', 'Invalid JSON format. Please check your input.');
      }
    }
    chatMetadata[EXTENSION_KEY][key] = newValue;
    saveMetadataDebounced();
    st_echo('success', `${isSchema ? 'Schema' : 'HTML'} updated successfully.`);
  }
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
