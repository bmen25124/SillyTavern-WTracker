import { FC, useState, useMemo, useCallback } from 'react';
import {
  STConnectionProfileSelect,
  STPresetSelect,
  STButton,
  STTextarea,
  PresetItem,
} from 'sillytavern-utils-lib/components';
import { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import {
  ExtensionSettings,
  Schema,
  DEFAULT_PROMPT,
  DEFAULT_PROMPT_JSON,
  DEFAULT_PROMPT_XML,
  DEFAULT_SCHEMA_VALUE,
  DEFAULT_SCHEMA_HTML,
  PromptEngineeringMode,
  defaultSettings,
  EXTENSION_KEY,
} from '../config.js';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import { useForceUpdate } from '../hooks/useForceUpdate.js';

// Initialize the settings manager once, outside the component
export const settingsManager = new ExtensionSettingsManager<ExtensionSettings>(EXTENSION_KEY, defaultSettings);

export const WTrackerSettings: FC = () => {
  const forceUpdate = useForceUpdate();
  const settings = settingsManager.getSettings();
  const [schemaText, setSchemaText] = useState('');

  const updateAndRefresh = useCallback(
    (updater: (currentSettings: ExtensionSettings) => void) => {
      const currentSettings = settingsManager.getSettings();
      updater(currentSettings);
      settingsManager.saveSettings();
      forceUpdate();
    },
    [forceUpdate],
  );

  // Memoized data for the schema preset dropdown
  const schemaPresetItems = useMemo((): PresetItem[] => {
    return Object.entries(settings.schemaPresets).map(([value, preset]) => ({
      value,
      label: preset.name,
    }));
  }, [settings.schemaPresets]);

  // Handler for when a new schema preset is selected
  const handleSchemaPresetChange = (newValue?: string) => {
    const newPresetKey = newValue ?? 'default';
    const newPreset = settings.schemaPresets[newPresetKey];
    if (newPreset) {
      updateAndRefresh((settings) => {
        settings.schemaPreset = newPresetKey;
      });
      setSchemaText(JSON.stringify(newPreset.value, null, 2));
    }
  };

  // Handler for when the list of presets is modified (created, renamed, deleted)
  const handleSchemaPresetsListChange = (newItems: PresetItem[]) => {
    updateAndRefresh((s) => {
      const newPresets: Record<string, Schema> = {};
      newItems.forEach((item) => {
        newPresets[item.value] =
          s.schemaPresets[item.value] ?? structuredClone(s.schemaPresets[s.schemaPreset] ?? s.schemaPresets['default']);
        // Ensure name is updated on rename
        newPresets[item.value].name = item.label;
      });
      s.schemaPresets = newPresets;
    });
  };

  // Handler for the schema JSON textarea
  const handleSchemaValueChange = (newSchemaText: string) => {
    setSchemaText(newSchemaText); // Update UI immediately
    try {
      const parsedJson = JSON.parse(newSchemaText);
      updateAndRefresh((s) => {
        const preset = s.schemaPresets[s.schemaPreset];
        if (preset) {
          // Create a new presets object with the updated value
          s.schemaPresets = {
            ...s.schemaPresets,
            [s.schemaPreset]: { ...preset, value: parsedJson },
          };
        }
      });
    } catch (e) {
      // Invalid JSON, do nothing until it's valid. A visual error could be added.
    }
  };

  // Handler for the schema HTML textarea
  const handleSchemaHtmlChange = (newHtml: string) => {
    updateAndRefresh((s) => {
      const preset = s.schemaPresets[s.schemaPreset];
      if (preset) {
        // Create a new presets object with the updated html
        s.schemaPresets = {
          ...s.schemaPresets,
          [s.schemaPreset]: { ...preset, html: newHtml },
        };
      }
    });
  };

  // Restore the current schema preset to its default values
  const restoreSchemaToDefault = async () => {
    const confirm = await SillyTavern.getContext().Popup.show.confirm(
      'Restore Default',
      'Are you sure you want to restore the default schema and HTML for this preset?',
    );
    if (!confirm) return;

    const currentPresetKey = settings.schemaPreset;
    updateAndRefresh((s) => {
      const preset = s.schemaPresets[currentPresetKey];
      if (preset) {
        s.schemaPresets = {
          ...s.schemaPresets,
          [currentPresetKey]: {
            ...preset,
            value: DEFAULT_SCHEMA_VALUE,
            html: DEFAULT_SCHEMA_HTML,
          },
        };
      }
    });
    setSchemaText(JSON.stringify(DEFAULT_SCHEMA_VALUE, null, 2));
  };

  return (
    <div className="wtracker-settings">
      <div className="inline-drawer">
        <div className="inline-drawer-toggle inline-drawer-header">
          <b>WTracker</b>
          <div className="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div className="inline-drawer-content">
          <div className="wtracker-container">
            <div className="setting-row">
              <label>Connection Profile</label>
              <STConnectionProfileSelect
                initialSelectedProfileId={settings.profileId}
                onChange={(profile) =>
                  updateAndRefresh((s) => {
                    s.profileId = profile?.id ?? '';
                  })
                }
              />
            </div>

            <div className="setting-row">
              <label>Auto Mode</label>
              <select
                className="text_pole"
                value={settings.autoMode}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.autoMode = e.target.value as AutoModeOptions;
                  })
                }
              >
                <option value="none">None</option>
                <option value="responses">Process responses</option>
                <option value="inputs">Process inputs</option>
                <option value="both">Process both</option>
              </select>
            </div>

            <div className="setting-row">
              <label>Prompt Engineering</label>
              <select
                className="text_pole"
                value={settings.promptEngineeringMode}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.promptEngineeringMode = e.target.value as PromptEngineeringMode;
                  })
                }
              >
                <option value="native">Native API</option>
                <option value="json">Prompt Engineering (JSON)</option>
                <option value="xml">Prompt Engineering (XML)</option>
              </select>
            </div>

            <div className="setting-row">
              <label>Schema Preset</label>
              <STPresetSelect
                label="Schema Preset"
                items={schemaPresetItems}
                value={settings.schemaPreset}
                onChange={handleSchemaPresetChange}
                onItemsChange={handleSchemaPresetsListChange}
                readOnlyValues={['default']}
                enableCreate
                enableDelete
                enableRename
              />

              <div className="title_restorable">
                <span>Schema</span>
                <STButton className="fa-solid fa-undo" title="Restore default" onClick={restoreSchemaToDefault} />
              </div>

              <STTextarea value={schemaText} onChange={(e) => handleSchemaValueChange(e.target.value)} rows={4} />
              <STTextarea
                value={settings.schemaPresets[settings.schemaPreset]?.html ?? ''}
                onChange={(e) => handleSchemaHtmlChange(e.target.value)}
                rows={4}
                placeholder="Enter your schema HTML here..."
              />
            </div>

            <div className="setting-row">
              <div className="title_restorable">
                <span>Prompt</span>
                <STButton
                  className="fa-solid fa-undo"
                  title="Restore main context template to default"
                  onClick={() =>
                    updateAndRefresh((s) => {
                      s.prompt = DEFAULT_PROMPT;
                    })
                  }
                />
              </div>
              <STTextarea
                value={settings.prompt}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.prompt = e.target.value;
                  })
                }
                rows={4}
              />
            </div>

            <div className="setting-row">
              <div className="title_restorable">
                <span>Prompt (JSON)</span>
                <STButton
                  className="fa-solid fa-undo"
                  title="Restore main context template to default"
                  onClick={() =>
                    updateAndRefresh((s) => {
                      s.promptJson = DEFAULT_PROMPT_JSON;
                    })
                  }
                />
              </div>
              <STTextarea
                value={settings.promptJson}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.promptJson = e.target.value;
                  })
                }
                rows={4}
              />
            </div>

            <div className="setting-row">
              <div className="title_restorable">
                <span>Prompt (XML)</span>
                <STButton
                  className="fa-solid fa-undo"
                  title="Restore main context template to default"
                  onClick={() =>
                    updateAndRefresh((s) => {
                      s.promptXml = DEFAULT_PROMPT_XML;
                    })
                  }
                />
              </div>
              <STTextarea
                value={settings.promptXml}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.promptXml = e.target.value;
                  })
                }
                rows={4}
              />
            </div>

            <div className="setting-row">
              <label>Max Response Tokens</label>
              <input
                type="number"
                className="text_pole"
                min="1"
                step="1"
                value={settings.maxResponseToken}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.maxResponseToken = parseInt(e.target.value) || 0;
                  })
                }
              />
            </div>
            <div className="setting-row">
              <label>Include Last X Messages</label>
              <input
                type="number"
                className="text_pole"
                min="0"
                step="1"
                title="0 means all messages."
                value={settings.includeLastXMessages}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.includeLastXMessages = parseInt(e.target.value) || 0;
                  })
                }
              />
            </div>
            <div className="setting-row">
              <label>Include Last X WTracker Messages</label>
              <input
                type="number"
                className="text_pole"
                min="0"
                step="1"
                title="0 means none."
                value={settings.includeLastXWTrackerMessages}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.includeLastXWTrackerMessages = parseInt(e.target.value) || 0;
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
