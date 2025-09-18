import React from 'react';
import { createRoot } from 'react-dom/client';
import { settingsManager, WTrackerSettings } from './components/Settings.js';

import { buildPrompt, Message, Generator } from 'sillytavern-utils-lib';
import { ChatMessage, EventNames, ExtractedData } from 'sillytavern-utils-lib/types';
import {
  characters,
  name1,
  name2,
  selected_group,
  sendChatMessage,
  st_echo,
  this_chid,
  user_avatar,
} from 'sillytavern-utils-lib/config';
import {
  ExtensionSettings,
  PromptEngineeringMode,
  EXTENSION_KEY,
  extensionName,
  AI_RESPONSE_SCHEMA,
  st_updateMessageBlock,
} from './config.js';
import { parseResponse } from './parser.js';
import { schemaToExample } from './schema-to-example.js';
import * as Handlebars from 'handlebars';

// --- Constants and Globals ---
const MESSAGE_NARRATIVE_KEY = 'narrative';
const MESSAGE_CHOICES_KEY = 'choices';
const MESSAGE_WORLDSTATE_KEY = 'worldState';

const globalContext = SillyTavern.getContext();
const generator = new Generator();
const pendingRequests = new Map<string, AbortController>();

if (!Handlebars.helpers['join']) {
  Handlebars.registerHelper('join', (array: any, separator: any) =>
    Array.isArray(array) ? array.join(typeof separator === 'string' ? separator : ', ') : '',
  );
}

// --- Core Logic ---

function renderTurn(messageId: number) {
  const message = globalContext.chat[messageId];
  const messageBlock = document.querySelector(`.mes[mesid="${messageId}"]`);
  if (!messageBlock) return;

  messageBlock.querySelector('.wtracker-container')?.remove();
  messageBlock.querySelector('.wtracker-choices')?.remove();

  if (!message?.extra?.[EXTENSION_KEY]) return;

  const narrative = message.extra[EXTENSION_KEY][MESSAGE_NARRATIVE_KEY];
  const choices = message.extra[EXTENSION_KEY][MESSAGE_CHOICES_KEY];
  const worldState = message.extra[EXTENSION_KEY][MESSAGE_WORLDSTATE_KEY];
  const settings = settingsManager.getSettings();
  const worldStateHtmlSchema = settings.schemaPresets[settings.schemaPreset]?.html;

  if (narrative && message.mes !== narrative) {
    message.mes = narrative;
    st_updateMessageBlock(messageId, message);
  }

  if (worldState && worldStateHtmlSchema) {
    const template = Handlebars.compile(worldStateHtmlSchema, { noEscape: true, strict: true });
    const renderedHtml = template({ data: worldState });
    const container = document.createElement('div');
    container.className = 'wtracker-container';
    container.innerHTML = renderedHtml;
    messageBlock.querySelector('.mes_text')?.before(container);
  }

  if (Array.isArray(choices) && choices.length > 0) {
    const choicesContainer = document.createElement('div');
    choicesContainer.className = 'wtracker-choices';
    choices.forEach((choiceText) => {
      const button = document.createElement('button');
      button.className = 'wtracker-choice-button';
      button.textContent = choiceText;
      choicesContainer.appendChild(button);
    });
    messageBlock.querySelector('.mes_text')?.after(choicesContainer);
  }
}

function findLastWorldState() {
  for (let i = globalContext.chat.length - 1; i >= 0; i--) {
    const message = globalContext.chat[i];
    const worldState = message?.extra?.[EXTENSION_KEY]?.[MESSAGE_WORLDSTATE_KEY];
    if (worldState) return worldState;
  }
  return null;
}

async function generateTurn(action: string) {
  const newContext = SillyTavern.getContext();
  const settings = settingsManager.getSettings();
  if (!settings.profileId) return st_echo('error', 'Please select a connection profile in SMRP settings.');

  const startButton = document.querySelector('#wtracker_start_game .extensionsMenuExtensionButton');
  startButton?.classList.add('spinning');
  try {
    let userActionContent = action;
    if (settings.diceRollsEnabled) {
      const result = Math.floor(Math.random() * 20) + 1;
      const extendedDiceTemplate = globalContext.substituteParams(settings.diceRollTemplate);
      const extendedActionTemplate = globalContext.substituteParams(settings.userActionTemplate);
      const diceTemplate = Handlebars.compile(extendedDiceTemplate, { noEscape: true, strict: true });
      const actionTemplate = Handlebars.compile(extendedActionTemplate, { noEscape: true, strict: true });
      userActionContent = `${actionTemplate({ action })} ${diceTemplate({ result })}`;
    }
    await sendChatMessage(userActionContent, 'system', 'System', user_avatar);
    const lastMessageId = newContext.chat.length - 1;

    const currentWorldState = findLastWorldState();

    const message = newContext.chat[lastMessageId];
    const profile = newContext.extensionSettings.connectionManager?.profiles?.find((p) => p.id === settings.profileId);
    const apiMap = profile?.api ? newContext.CONNECT_API_MAP[profile.api] : null;
    let characterId = characters.findIndex((char: any) => char.avatar === message.original_avatar);
    characterId = characterId !== -1 ? characterId : undefined;
    const promptResult = await buildPrompt(apiMap?.selected!, {
      targetCharacterId: characterId,
      messageIndexesBetween: {
        end: lastMessageId,
        start: settings.includeLastXMessages > 0 ? Math.max(0, lastMessageId - settings.includeLastXMessages) : 0,
      },
      presetName: profile?.preset,
      contextName: profile?.context,
      instructName: profile?.instruct,
      syspromptName: profile?.sysprompt,
      includeNames: !!selected_group,
    });

    let messages = promptResult.result;
    let response: ExtractedData['content'];

    const makeRequest = (requestMessages: Message[], overridePayload?: any): Promise<ExtractedData | undefined> => {
      return new Promise((resolve, reject) => {
        const abortController = new AbortController();
        generator.generateRequest(
          {
            profileId: settings.profileId,
            prompt: requestMessages,
            maxTokens: settings.maxResponseToken,
            custom: { signal: abortController.signal },
            overridePayload,
          },
          {
            abortController,
            onStart: (reqId) => pendingRequests.set(reqId, abortController),
            onFinish: (reqId, data, error) => {
              pendingRequests.delete(reqId);
              if (error) return reject(error);
              if (!data) return reject(new DOMException('Request aborted', 'AbortError'));
              resolve(data as ExtractedData | undefined);
            },
          },
        );
      });
    };

    if (currentWorldState) {
      const worldStateString = `Current World State:\n\`\`\`json\n${JSON.stringify(currentWorldState, null, 2)}\n\`\`\``;
      messages.push({ role: 'system', content: worldStateString });
    }

    const worldStateSchema = settings.schemaPresets[settings.schemaPreset].value;
    const combinedSchema = { ...AI_RESPONSE_SCHEMA };
    // @ts-ignore
    combinedSchema.properties.worldStateUpdate = worldStateSchema;

    if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
      const extendedPrompt = globalContext.substituteParams(settings.prompt);
      messages.push({ content: extendedPrompt, role: 'user' });
      const result = await makeRequest(messages, {
        json_schema: { name: 'SMRP_Response', strict: true, value: combinedSchema },
      });
      // @ts-ignore
      response = result?.content;
    } else {
      const format = settings.promptEngineeringMode as 'json' | 'xml';
      const promptTemplate = format === 'json' ? settings.promptJson : settings.promptXml;
      const exampleResponse = schemaToExample(combinedSchema, format);
      let finalPrompt = Handlebars.compile(promptTemplate, { noEscape: true, strict: true })({
        schema: JSON.stringify(combinedSchema, null, 2),
        example_response: exampleResponse,
      });
      finalPrompt = globalContext.substituteParams(finalPrompt);
      messages.push({ content: finalPrompt, role: 'user' });
      const result = await makeRequest(messages);
      if (!result?.content) throw new Error('No response content received from AI.');
      // @ts-ignore
      response = parseResponse(result.content as string, format, { schema: combinedSchema });
    }

    if (!response || typeof response !== 'object') throw new Error('AI response was not a valid object.');
    const { narrative, choices, worldStateUpdate } = response;
    if (!narrative || !worldStateUpdate) throw new Error('AI response is missing narrative or worldStateUpdate.');

    await sendChatMessage(narrative, 'assistant', name2, characters[this_chid].avatar);
    const lastMessage = newContext.chat[newContext.chat.length - 1];
    lastMessage.extra = lastMessage.extra || {};
    lastMessage.extra[EXTENSION_KEY] = {
      [MESSAGE_NARRATIVE_KEY]: narrative,
      [MESSAGE_CHOICES_KEY]: settings.choicesEnabled ? choices || [] : [],
      [MESSAGE_WORLDSTATE_KEY]: worldStateUpdate,
    };

    await globalContext.saveChat();
    renderTurn(globalContext.chat.length - 1);
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      console.error('Error generating SMRP turn:', error);
      st_echo('error', `SMRP turn failed: ${(error as Error).message}`);
    }
  } finally {
    startButton?.classList.remove('spinning');
  }
}

async function startGame() {
  const confirm = await globalContext.Popup.show.confirm(
    'Start New SMRP Game?',
    'This will start a new story. Continue?',
  );
  if (!confirm) return;
  await generateTurn('Begin the adventure by describing the scene and providing the first choices.');
}

async function initializeGlobalUI() {
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
  extensionsMenu?.querySelector('#wtracker_start_game')?.addEventListener('click', startGame);

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.classList.contains('wtracker-choice-button')) {
      if (target.textContent) generateTurn(target.textContent);
    }
  });

  const wtrackerSendHtml = `
<div id="wtracked_send" class="fa-solid fa-paper-plane interactable" title="Send via WTracker" data-i18n="[title]Send via WTracker" tabindex="2"></div>
  `;
  document.getElementById('rightSendForm')?.insertAdjacentHTML('beforeend', wtrackerSendHtml);

  document.getElementById('wtracked_send')?.addEventListener('click', async () => {
    await generateTurn((document.getElementById('send_textarea') as HTMLTextAreaElement)?.value || '');
  });

  globalContext.eventSource.on(EventNames.CHAT_CHANGED, () => {
    globalContext.chat.forEach((_, i) => renderTurn(i));
  });

  (globalThis as any).wtrackerGenerateInterceptor = () => { };
}

function renderReactSettings() {
  const settingsContainer = document.getElementById('extensions_settings');
  if (!settingsContainer) return;
  let reactRootEl = document.getElementById('wtracker-react-settings-root');
  if (!reactRootEl) {
    reactRootEl = document.createElement('div');
    reactRootEl.id = 'wtracker-react-settings-root';
    settingsContainer.appendChild(reactRootEl);
  }
  createRoot(reactRootEl).render(
    <React.StrictMode>
      <WTrackerSettings />
    </React.StrictMode>,
  );
}

settingsManager
  .initializeSettings()
  .then(() => {
    renderReactSettings();
    initializeGlobalUI();
  })
  .catch(console.error);
