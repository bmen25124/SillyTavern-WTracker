import { FC, useState, useMemo, useCallback } from 'react';
import {
  STConnectionProfileSelect,
  STPresetSelect,
  STButton,
  STTextarea,
  PresetItem,
  STInput,
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
  DEFAULT_USER_ACTION_TEMPLATE,
  DEFAULT_DICE_ROLL_TEMPLATE,
  PromptEngineeringMode,
  defaultSettings,
  EXTENSION_KEY,
} from '../config.js';
import { useForceUpdate } from '../hooks/useForceUpdate.js';

export const settingsManager = new ExtensionSettingsManager<ExtensionSettings>(EXTENSION_KEY, defaultSettings);

export const WTrackerSettings: FC = () => {
  const forceUpdate = useForceUpdate();
  const settings = settingsManager.getSettings();
  const [schemaText, setSchemaText] = useState(
    JSON.stringify(settings.schemaPresets[settings.schemaPreset]?.value, null, 2) ?? '',
  );

  const updateAndRefresh = useCallback(
    (updater: (currentSettings: ExtensionSettings) => void) => {
      const currentSettings = settingsManager.getSettings();
      updater(currentSettings);
      settingsManager.saveSettings();
      forceUpdate();
    },
    [forceUpdate],
  );

  const schemaPresetItems = useMemo((): PresetItem[] => {
    return Object.entries(settings.schemaPresets).map(([value, preset]) => ({
      value,
      label: preset.name,
    }));
  }, [settings.schemaPresets]);

  const handleSchemaPresetChange = (newValue?: string) => {
    const newPresetKey = newValue ?? 'default';
    const newPreset = settings.schemaPresets[newPresetKey];
    if (newPreset) {
      updateAndRefresh((s) => {
        s.schemaPreset = newPresetKey;
      });
      setSchemaText(JSON.stringify(newPreset.value, null, 2));
    }
  };

  const handleSchemaPresetsListChange = (newItems: PresetItem[]) => {
    updateAndRefresh((s) => {
      const newPresets: Record<string, Schema> = {};
      newItems.forEach((item) => {
        newPresets[item.value] =
          s.schemaPresets[item.value] ?? structuredClone(s.schemaPresets[s.schemaPreset] ?? s.schemaPresets['default']);
        newPresets[item.value].name = item.label;
      });
      s.schemaPresets = newPresets;
    });
  };

  const handleSchemaValueChange = (newSchemaText: string) => {
    setSchemaText(newSchemaText);
    try {
      const parsedJson = JSON.parse(newSchemaText);
      updateAndRefresh((s) => {
        const preset = s.schemaPresets[s.schemaPreset];
        if (preset) {
          s.schemaPresets = { ...s.schemaPresets, [s.schemaPreset]: { ...preset, value: parsedJson } };
        }
      });
    } catch (e) {}
  };

  const handleSchemaHtmlChange = (newHtml: string) => {
    updateAndRefresh((s) => {
      const preset = s.schemaPresets[s.schemaPreset];
      if (preset) {
        s.schemaPresets = { ...s.schemaPresets, [s.schemaPreset]: { ...preset, html: newHtml } };
      }
    });
  };

  const restoreSchemaToDefault = async () => {
    const confirm = await SillyTavern.getContext().Popup.show.confirm(
      'Restore Default',
      'Restore default World State?',
    );
    if (!confirm) return;
    const currentPresetKey = settings.schemaPreset;
    updateAndRefresh((s) => {
      const preset = s.schemaPresets[currentPresetKey];
      if (preset) {
        s.schemaPresets[currentPresetKey] = { ...preset, value: DEFAULT_SCHEMA_VALUE, html: DEFAULT_SCHEMA_HTML };
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
                onChange={(profile) => updateAndRefresh((s) => (s.profileId = profile?.id ?? ''))}
              />
            </div>

            <div className="setting-row">
              <STInput
                type="checkbox"
                checked={settings.choicesEnabled}
                label="Enable Choices"
                onChange={(checked) => {
                  const res = checked.currentTarget.checked;
                  updateAndRefresh((s) => (s.choicesEnabled = res));
                }}
              />
              <STInput
                type="checkbox"
                checked={settings.diceRollsEnabled}
                label="Enable Automatic Dice Rolls"
                onChange={(checked) => {
                  const res = checked.currentTarget.checked;
                  updateAndRefresh((s) => (s.diceRollsEnabled = res));
                }}
              />
            </div>

            <div className="setting-row">
              <div className="title_restorable">
                <span>User Action Template</span>
                <STButton
                  className="fa-solid fa-undo"
                  title="Restore user action template to default"
                  onClick={() =>
                    updateAndRefresh((s) => {
                      s.userActionTemplate = DEFAULT_USER_ACTION_TEMPLATE;
                    })
                  }
                />
              </div>
              <STTextarea
                value={settings.userActionTemplate}
                onChange={(e) => updateAndRefresh((s) => (s.userActionTemplate = e.target.value))}
                rows={2}
                placeholder="Use {{action}} for the user's input."
              />
              <div className="title_restorable">
                <span>Dice Roll Template</span>
                <STButton
                  className="fa-solid fa-undo"
                  title="Restore dice roll template to default"
                  onClick={() =>
                    updateAndRefresh((s) => {
                      s.diceRollTemplate = DEFAULT_DICE_ROLL_TEMPLATE;
                    })
                  }
                />
              </div>
              <STTextarea
                value={settings.diceRollTemplate}
                onChange={(e) => updateAndRefresh((s) => (s.diceRollTemplate = e.target.value))}
                rows={2}
                placeholder="Use {{result}} for the dice number."
              />
            </div>

            <div className="setting-row">
              <label>Prompt Engineering</label>
              <select
                className="text_pole"
                value={settings.promptEngineeringMode}
                onChange={(e) =>
                  updateAndRefresh((s) => (s.promptEngineeringMode = e.target.value as PromptEngineeringMode))
                }
              >
                <option value="native">Native API</option>
                <option value="json">Prompt Engineering (JSON)</option>
                <option value="xml">Prompt Engineering (XML)</option>
              </select>
            </div>

            <div className="setting-row">
              <label>World State Preset</label>
              <STPresetSelect
                label="World State Preset"
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
                <span>World State Schema</span>
                <STButton className="fa-solid fa-undo" title="Restore default" onClick={restoreSchemaToDefault} />
              </div>
              <STTextarea value={schemaText} onChange={(e) => handleSchemaValueChange(e.target.value)} rows={4} />
              <STTextarea
                value={settings.schemaPresets[settings.schemaPreset]?.html ?? ''}
                onChange={(e) => handleSchemaHtmlChange(e.target.value)}
                rows={4}
                placeholder="Enter your World State HTML template here..."
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
              <label>Include Last X Messages (0 means all, 1 means last)</label>
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
          </div>
        </div>
      </div>
    </div>
  );
};
