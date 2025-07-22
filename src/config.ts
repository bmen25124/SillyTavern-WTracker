import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';

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
}

export const extensionName = 'SillyTavern-WTracker';

export const DEFAULT_PROMPT = `You are a Scene Tracker Assistant, tasked with providing clear, consistent, and structured updates to a scene tracker for a roleplay. Use the latest message, previous tracker details, and context from recent messages to accurately update the tracker. Your response must ensuring that each field is filled and complete. If specific information is not provided, make reasonable assumptions based on prior descriptions, logical inferences, or default character details.

### Key Instructions:
1. **Default Assumptions for Missing Information**:
   - **Character Details**: If no new details are provided for a character, assume reasonable defaults (e.g., hairstyle, posture, or attire based on previous entries or context).
   - **Outfit**: Describe the complete outfit for each character, using specific details for color, fabric, and style (e.g., “fitted black leather jacket with silver studs on the collar”). **Underwear must always be included in the outfit description.** If underwear is intentionally missing, specify this clearly in the description (e.g., "No bra", "No panties"). If the character is undressed, list the entire outfit.
   - **StateOfDress**: Describe how put-together or disheveled the character appears, including any removed clothing. If the character is undressed, indicate where discarded items are placed.
2. **Incremental Time Progression**:
   - Adjust time in small increments, ideally only a few seconds per update, to reflect realistic scene progression. Avoid large jumps unless a significant time skip (e.g., sleep, travel) is explicitly stated.
   - Format the time as "HH:MM:SS; MM/DD/YYYY (Day Name)".
3. **Context-Appropriate Times**:
   - Ensure that the time aligns with the setting. For example, if the scene takes place in a public venue (e.g., a mall), choose an appropriate time within standard operating hours.
4. **Location Format**: Avoid unintended reuse of specific locations from previous examples or responses. Provide specific, relevant, and detailed locations based on the context, using the format:
   - **Example**: “Food court, second floor near east wing entrance, Madison Square Mall, Los Angeles, CA”
5. **Topics Format**: Ensure topics are one- or two-word keywords relevant to the scene to help trigger contextual information. Avoid long phrases.
6. **Avoid Redundancies**: Use only details provided or logically inferred from context. Do not introduce speculative or unnecessary information.
7. **Focus and Pause**: Treat each scene update as a standalone, complete entry. Respond with the full tracker every time, even if there are only minor updates.

### Important Reminders:
1. **Recent Messages and Current Tracker**: Before updating, always consider the recent messages to ensure all changes are accurately represented.

Your primary objective is to ensure clarity, consistency, providing complete details even when specifics are not explicitly stated.`;

export const DEFAULT_SCHEMA_VALUE: object = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'SceneTracker',
  description: 'Schema for tracking roleplay scene details',
  type: 'object',
  properties: {
    time: {
      type: 'string',
      description: 'Format: HH:MM:SS; MM/DD/YYYY (Day Name)',
    },
    location: {
      type: 'string',
      description: 'Specific scene location with increasing specificity',
    },
    weather: {
      type: 'string',
      description: 'Current weather conditions and temperature',
    },
    topics: {
      type: 'object',
      properties: {
        primaryTopic: {
          type: 'string',
          description: '1-2 word main topic of interaction',
        },
        emotionalTone: {
          type: 'string',
          description: 'Dominant emotional tone of scene',
        },
        interactionTheme: {
          type: 'string',
          description: 'Type of character interaction',
        },
      },
      required: ['primaryTopic', 'emotionalTone', 'interactionTheme'],
    },
    charactersPresent: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'List of character names present in scene',
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Character name',
          },
          hair: {
            type: 'string',
            description: 'Hairstyle and condition',
          },
          makeup: {
            type: 'string',
            description: "Makeup description or 'None'",
          },
          outfit: {
            type: 'string',
            description: 'Complete outfit including underwear',
          },
          stateOfDress: {
            type: 'string',
            description: 'How put-together/disheveled character appears',
          },
          postureAndInteraction: {
            type: 'string',
            description: "Character's physical positioning and interaction",
          },
        },
        required: ['name', 'hair', 'makeup', 'outfit', 'stateOfDress', 'postureAndInteraction'],
      },
      description: 'Array of character objects',
    },
  },
  required: ['time', 'location', 'weather', 'topics', 'charactersPresent', 'characters'],
};

export const DEFAULT_SCHEMA_HTML = `<div class="wtracker_default_mes_template">
    <!-- Main Scene Information -->
    <table>
        <tbody>
            <tr>
                <td>Time:</td>
                <td>{{data.time}}</td>
            </tr>
            <tr>
                <td>Location:</td>
                <td>{{data.location}}</td>
            </tr>
            <tr>
                <td>Weather:</td>
                <td>{{data.weather}}</td>
            </tr>
        </tbody>
    </table>

    <!-- Collapsible Detailed Tracker -->
    <details>
        <summary><span>Tracker Details</span></summary>
        <table>
            <tbody>
                <tr>
                    <td>Topics:</td>
                    <td>
                        <!-- Accessing nested object properties -->
                        {{data.topics.primaryTopic}}; {{data.topics.emotionalTone}}; {{data.topics.interactionTheme}}
                    </td>
                </tr>
                <tr>
                    <td>Present:</td>
                    <td>
                        <!-- Joining an array of strings. Assumes a 'join' helper. -->
                        {{#join ", " data.charactersPresent}}{{/join}}
                    </td>
                </tr>
            </tbody>
        </table>

        <!-- Character Details Section -->
        <div class="mes_wtracker_characters">
            <!-- Looping through the array of character objects -->
            {{#each data.characters as |character|}}
            <hr>
            <strong>{{character.name}}:</strong><br>
            <table>
                <tbody>
                    <tr>
                        <td>Hair:</td>
                        <td>{{character.hair}}</td>
                    </tr>
                    <tr>
                        <td>Makeup:</td>
                        <td>{{character.makeup}}</td>
                    </tr>
                    <tr>
                        <td>Outfit:</td>
                        <td>{{character.outfit}}</td>
                    </tr>
                    <tr>
                        <td>State:</td>
                        <td>{{character.stateOfDress}}</td>
                    </tr>
                    <tr>
                        <td>Position:</td>
                        <td>{{character.postureAndInteraction}}</td>
                    </tr>
                </tbody>
            </table>
            {{/each}}
        </div>
    </details>
</div>
<hr>`;
