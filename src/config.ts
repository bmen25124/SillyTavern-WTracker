// @ts-ignore
import { updateMessageBlock } from '../../../../../script.js';

import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';

export enum PromptEngineeringMode {
  NATIVE = 'native',
  JSON = 'json',
  XML = 'xml',
}

export interface Schema {
  name: string;
  value: object;
  html: string;
}

export interface ExtensionSettings {
  version: string;
  formatVersion: string;
  profileId: string;
  maxResponseToken: number;
  autoMode: AutoModeOptions;
  schemaPreset: string;
  schemaPresets: Record<string, Schema>;
  prompt: string;
  includeLastXMessages: number; // 0 means all messages
  choicesEnabled: boolean;
  diceRollsEnabled: boolean;
  userActionTemplate: string;
  diceRollTemplate: string;
  promptEngineeringMode: PromptEngineeringMode;
  promptJson: string;
  promptXml: string;
}

export const extensionName = 'SillyTavern-WTracker';

export const DEFAULT_PROMPT = `You are a master storyteller and Game Master (GM). Your purpose is to create an interactive, engaging, and dynamic roleplaying experience. You will manage the story, the world, and the non-player characters (NPCs).

### Key Instructions:
1.  **Analyze User Action**: The user will provide their action and a dice roll result in a structured format. You must interpret this action within the context of the current world state and the narrative.
2.  **Determine Outcome**: Use the dice roll to determine the success, failure, or degree of success of the user's action. A high roll is good, a low roll is bad. Be creative with the outcomes.
3.  **Update the World**: Based on the outcome, update the world state. This includes time, location, character statuses, or any other relevant details. The world must feel persistent and reactive.
4.  **Narrate the Story**: Write a compelling narrative describing the outcome of the user's action and the world's reaction.
5.  **Provide New Choices**: If choices are enabled, present the user with 2-4 distinct and interesting choices for what they can do next. These choices should flow naturally from the narrative.
6.  **Adhere to the Format**: Your entire response MUST be a single, valid, structured object that contains the narrative, the new choices (if applicable), and the complete, updated world state.`;

export const DEFAULT_PROMPT_JSON = `You are a highly specialized AI Game Master. Your SOLE purpose is to generate a single, valid JSON object that strictly adheres to the provided JSON schema. This object drives an interactive roleplaying game.

**CRITICAL INSTRUCTIONS:**
1.  You MUST wrap the entire JSON object in a markdown code block (\`\`\`json\\n...\\n\`\`\`).
2.  Your response MUST NOT contain any explanatory text, comments, or any other content outside of this single code block.
3.  The JSON object inside the code block MUST be valid and conform to the schema.
4.  Analyze the user's action and dice roll, update the world state, write a new narrative, and provide new choices if enabled.

**RESPONSE JSON SCHEMA TO FOLLOW:**
\`\`\`json
{{schema}}
\`\`\`

**EXAMPLE OF A PERFECT RESPONSE:**
\`\`\`json
{{example_response}}
\`\`\`
`;

export const DEFAULT_PROMPT_XML = `You are a highly specialized AI Game Master. Your SOLE purpose is to generate a single, valid XML structure that strictly adheres to the provided example. This object drives an interactive roleplaying game.

**CRITICAL INSTRUCTIONS:**
1.  You MUST wrap the entire XML object in a markdown code block (\`\`\`xml\\n...\\n\`\`\`).
2.  Your response MUST NOT contain any explanatory text, comments, or any other content outside of this single code block.
3.  The XML object inside the code block MUST be valid.
4.  Analyze the user's action and dice roll, update the world state, write a new narrative, and provide new choices if enabled.

**RESPONSE JSON SCHEMA (for context):**
\`\`\`json
{{schema}}
\`\`\`

**EXAMPLE OF A PERFECT RESPONSE (XML):**
\`\`\`xml
<root>
{{example_response}}
</root>
\`\`\`
`;

export const AI_RESPONSE_SCHEMA: object = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'AI_GameMaster_Response',
  description: 'The structured response from the AI Game Master for each turn.',
  type: 'object',
  properties: {
    narrative: {
      type: 'string',
      description: 'The story narration for the current turn, describing the outcome of the player action.',
    },
    choices: {
      type: 'array',
      description:
        'A list of 2-4 actions the player can take next. Can be an empty array if choices are disabled or not applicable.',
      items: {
        type: 'string',
      },
    },
    worldStateUpdate: {
      type: 'object',
      description: 'The complete and updated world state after the current turn.',
    },
  },
  required: ['narrative', 'choices', 'worldStateUpdate'],
};

export const DEFAULT_SCHEMA_VALUE: object = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'SceneTracker',
  description: 'Schema for tracking roleplay scene details (used as World State in SMRP)',
  type: 'object',
  properties: {
    time: { type: 'string', description: 'Format: HH:MM:SS; MM/DD/YYYY (Day Name)' },
    location: { type: 'string', description: 'Specific scene location' },
    weather: { type: 'string', description: 'Current weather conditions' },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Character name' },
          outfit: { type: 'string', description: 'Complete outfit' },
          stateOfDress: { type: 'string', description: 'How put-together/disheveled character appears' },
        },
        required: ['name', 'outfit', 'stateOfDress'],
      },
      description: 'Array of character objects',
    },
  },
  required: ['time', 'location', 'weather', 'characters'],
};

export const DEFAULT_SCHEMA_HTML = `<div class="wtracker_default_mes_template">
    <h4>World State</h4>
    <table>
        <tbody>
            <tr><td>Time:</td><td>{{data.time}}</td></tr>
            <tr><td>Location:</td><td>{{data.location}}</td></tr>
            <tr><td>Weather:</td><td>{{data.weather}}</td></tr>
        </tbody>
    </table>
    <details>
        <summary><span>Characters</span></summary>
        <div class="mes_wtracker_characters">
            {{#each data.characters as |character|}}
            <hr>
            <strong>{{character.name}}:</strong><br>
            <table>
                <tbody>
                    <tr><td>Outfit:</td><td>{{character.outfit}}</td></tr>
                    <tr><td>State:</td><td>{{character.stateOfDress}}</td></tr>
                </tbody>
            </table>
            {{/each}}
        </div>
    </details>
</div>
<hr>`;

const VERSION = '0.1.0';
const FORMAT_VERSION = 'F_1.0';
export const EXTENSION_KEY = 'WTracker';

export const defaultSettings: ExtensionSettings = {
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
  choicesEnabled: true,
  diceRollsEnabled: true,
  userActionTemplate: 'My action: {{action}}',
  diceRollTemplate: '(Dice Roll 1d20: {{result}})',
  promptEngineeringMode: PromptEngineeringMode.NATIVE,
  promptJson: DEFAULT_PROMPT_JSON,
  promptXml: DEFAULT_PROMPT_XML,
};

export function st_updateMessageBlock(messageId: number, message: object, { rerenderMessage = true } = {}): void {
  updateMessageBlock(messageId, message, { rerenderMessage });
}
