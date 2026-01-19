import { eventSource, event_types, saveSettingsDebounced, substituteParams, characters, this_chid, name1 } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync, getContext } from '../../../extensions.js';
import { power_user } from '../../../power-user.js';

const extensionName = 'third-party/CYOA';
const extensionFolderPath = `scripts/extensions/${extensionName}`;

const defaultSettings = {
    enabled: false,
    apiEndpoint: '',
    apiKey: '',
    model: 'gpt-4o-mini',
    numberOfOptions: 3,
    contextLength: 10,
    maxTokens: 500,
    usePreset: false,
    uploadedPreset: null,
    postProcessing: 'none',
    preservedTags: '',
    systemPrompt: `You are a CYOA (Choose Your Own Adventure) option generator. Based on the conversation context provided, generate exactly {n} distinct action options that {user} could take next.

Each option should be:
- Written in first person from {user}'s perspective
- A short, actionable choice (1-2 sentences max)
- Distinct from other options (offer variety: cautious, bold, curious, etc.)

Respond ONLY with a JSON array of strings, nothing else. Example format:
["I approach the stranger carefully.", "I draw my weapon and demand answers.", "I hide and observe from a distance."]`,
};

function loadSettings() {
    if (!extension_settings.cyoa) {
        extension_settings.cyoa = {};
    }

    for (const key in defaultSettings) {
        if (extension_settings.cyoa[key] === undefined) {
            extension_settings.cyoa[key] = defaultSettings[key];
        }
    }

    $('#cyoa_enabled').prop('checked', extension_settings.cyoa.enabled);
    $('#cyoa_api_endpoint').val(extension_settings.cyoa.apiEndpoint);
    $('#cyoa_api_key').val(extension_settings.cyoa.apiKey);
    $('#cyoa_model').val(extension_settings.cyoa.model);
    $('#cyoa_num_options').val(extension_settings.cyoa.numberOfOptions);
    $('#cyoa_context_length').val(extension_settings.cyoa.contextLength);
    $('#cyoa_max_tokens').val(extension_settings.cyoa.maxTokens);
    $('#cyoa_use_preset').prop('checked', extension_settings.cyoa.usePreset);
    $('#cyoa_post_processing').val(extension_settings.cyoa.postProcessing);
    $('#cyoa_preserved_tags').val(extension_settings.cyoa.preservedTags);
    $('#cyoa_system_prompt').val(extension_settings.cyoa.systemPrompt);
    updatePresetUI(extension_settings.cyoa.uploadedPreset);
}

function saveSettings() {
    extension_settings.cyoa.enabled = $('#cyoa_enabled').prop('checked');
    extension_settings.cyoa.apiEndpoint = $('#cyoa_api_endpoint').val().trim();
    extension_settings.cyoa.apiKey = $('#cyoa_api_key').val().trim();
    extension_settings.cyoa.model = $('#cyoa_model').val().trim();
    extension_settings.cyoa.numberOfOptions = parseInt($('#cyoa_num_options').val());
    extension_settings.cyoa.contextLength = parseInt($('#cyoa_context_length').val());
    extension_settings.cyoa.maxTokens = parseInt($('#cyoa_max_tokens').val());
    extension_settings.cyoa.usePreset = $('#cyoa_use_preset').prop('checked');
    extension_settings.cyoa.postProcessing = $('#cyoa_post_processing').val();
    extension_settings.cyoa.preservedTags = $('#cyoa_preserved_tags').val();
    extension_settings.cyoa.systemPrompt = $('#cyoa_system_prompt').val();
    saveSettingsDebounced();
}

// ============== Preset Functions ==============

function hasActualContent(content) {
    if (!content || typeof content !== 'string') return false;

    let cleaned = content
        .replace(/\{\{\/\/[^}]*\}\}/g, '')
        .replace(/\{\{trim\}\}/gi, '')
        .replace(/\{\{noop\}\}/gi, '')
        .trim();

    const hasTextOutsideMacros = cleaned.replace(/\{\{[^}]*\}\}/g, '').trim().length > 0;
    const hasContentMacros = /\{\{(char|user|persona|scenario|personality|description|system|original|input|message)\}\}/i.test(cleaned);

    return cleaned.length > 0 && (hasTextOutsideMacros || hasContentMacros);
}

async function parsePresetFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            try {
                const preset = JSON.parse(event.target.result);

                if (!preset.prompts || !Array.isArray(preset.prompts)) {
                    reject(new Error('Invalid preset format: missing prompts array'));
                    return;
                }

                if (!preset.prompt_order || !Array.isArray(preset.prompt_order)) {
                    reject(new Error('Invalid preset format: missing prompt_order array'));
                    return;
                }

                const promptMap = new Map();
                for (const prompt of preset.prompts) {
                    if (prompt.identifier) {
                        promptMap.set(prompt.identifier, prompt);
                    }
                }

                const customOrder = preset.prompt_order.find(po => po.character_id === 100001);
                if (!customOrder || !customOrder.order) {
                    reject(new Error('Invalid preset format: missing custom prompt order'));
                    return;
                }

                const enabledPrompts = [];
                for (const entry of customOrder.order) {
                    if (entry.enabled && entry.identifier) {
                        const prompt = promptMap.get(entry.identifier);
                        if (prompt && !prompt.marker && prompt.content && prompt.role && hasActualContent(prompt.content)) {
                            enabledPrompts.push({
                                identifier: prompt.identifier,
                                role: prompt.role,
                                content: prompt.content
                            });
                        }
                    }
                }

                const presetName = file.name.replace(/\.json$/i, '');
                resolve({ name: presetName, prompts: enabledPrompts });
            } catch (error) {
                reject(new Error('Failed to parse preset file: ' + error.message));
            }
        };

        reader.onerror = () => reject(new Error('Failed to read preset file'));
        reader.readAsText(file);
    });
}

async function handlePresetUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        const presetData = await parsePresetFile(file);
        extension_settings.cyoa.uploadedPreset = presetData;
        saveSettingsDebounced();
        updatePresetUI(presetData);
        toastr.success(`Loaded preset "${presetData.name}" with ${presetData.prompts.length} prompts`, 'CYOA');
    } catch (error) {
        console.error('[CYOA] Failed to load preset:', error);
        toastr.error(error.message, 'CYOA');
    }

    event.target.value = '';
}

function clearUploadedPreset() {
    extension_settings.cyoa.uploadedPreset = null;
    saveSettingsDebounced();
    updatePresetUI(null);
    toastr.info('Preset cleared', 'CYOA');
}

function updatePresetUI(presetData) {
    const infoContainer = $('#cyoa_preset_info');
    const uploadBtn = $('#cyoa_preset_upload_btn');
    const clearBtn = $('#cyoa_preset_clear_btn');

    if (presetData) {
        infoContainer.html(`<span class="cyoa-preset-loaded"><i class="fa-solid fa-check-circle"></i> ${presetData.name} (${presetData.prompts.length} prompts)</span>`);
        uploadBtn.text('Change');
        clearBtn.show();
    } else {
        infoContainer.html('<span class="cyoa-preset-none">No preset loaded</span>');
        uploadBtn.text('Upload');
        clearBtn.hide();
    }
}

function getUploadedPresetPrompts() {
    const uploadedPreset = extension_settings.cyoa.uploadedPreset;
    if (!uploadedPreset || !uploadedPreset.prompts) return [];

    return uploadedPreset.prompts.map(p => {
        let content = p.content;
        try {
            content = substituteParams(content);
        } catch (error) {
            console.warn('[CYOA] Failed to substitute macros:', error);
        }
        return { role: p.role, content: content };
    });
}

function applyPostProcessing(messages, mode) {
    if (!messages || messages.length === 0 || mode === 'none') {
        return messages;
    }

    if (mode === 'semi-strict') {
        // Semi-Strict: Convert ALL system messages to user messages
        return messages.map(msg => {
            if (msg.role === 'system') {
                return { role: 'user', content: msg.content };
            }
            return msg;
        });
    }

    if (mode === 'strict') {
        // Strict: Only allow system messages at the very start, convert rest to user
        let foundFirstSystem = false;
        return messages.map(msg => {
            if (msg.role === 'system') {
                if (!foundFirstSystem) {
                    foundFirstSystem = true;
                    return msg;
                }
                return { role: 'user', content: msg.content };
            }
            return msg;
        });
    }

    return messages;
}

function getCharacterData() {
    if (this_chid === undefined || this_chid === null) return null;
    const character = characters[this_chid];
    if (!character) return null;
    return {
        name: character.name || '',
        description: character.description || '',
        personality: character.personality || '',
        scenario: character.scenario || '',
    };
}

function getUserPersonaData() {
    const context = getContext();
    const userName = name1 || context.name1 || 'User';
    const personaDescription = power_user?.persona_description || '';
    if (!personaDescription) return null;
    return {
        name: userName,
        description: personaDescription,
    };
}

function cleanMessageText(text) {
    if (!text) return '';

    // Get preserved tags from settings
    const preservedTagsStr = extension_settings.cyoa.preservedTags || '';
    const preservedTags = preservedTagsStr
        .split(/[,\s]+/)
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 0);

    function processContent(content) {
        let result = content;

        // Process tags from innermost to outermost by repeatedly applying until no changes
        let changed = true;
        while (changed) {
            const before = result;

            // Match innermost tags first (tags that don't contain other tags of the same name)
            result = result.replace(/<(\w+)([^>]*)>((?:(?!<\1[\s>])[\s\S])*?)<\/\1>/gi, (match, tagName, attrs, innerContent) => {
                const tagLower = tagName.toLowerCase();
                if (preservedTags.includes(tagLower)) {
                    // Preserve this tag, but process inner content recursively
                    const processedInner = processContent(innerContent);
                    return `<${tagName}${attrs}>${processedInner}</${tagName}>`;
                }
                // Remove this tag and its content entirely
                return '';
            });

            changed = (before !== result);
        }

        // Remove any remaining unclosed tags and their content to end (non-preserved only)
        result = result.replace(/<(\w+)[^>]*>[\s\S]*/gi, (match, tagName) => {
            if (preservedTags.includes(tagName.toLowerCase())) {
                return match;
            }
            return '';
        });

        // Remove any standalone tags (but preserve specified ones)
        result = result.replace(/<\/?(\w+)[^>]*>/g, (match, tagName) => {
            if (preservedTags.includes(tagName.toLowerCase())) {
                return match;
            }
            return '';
        });

        return result;
    }

    let cleaned = processContent(text);

    // Remove codeblocks ```...```
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');

    // Remove image markdown ![...](...)
    cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

    // Clean up excessive whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    return cleaned;
}

function buildContext() {
    const context = getContext();
    const chat = context.chat;
    const charName = context.name2 || 'Character';
    const userName = context.name1 || 'User';
    const contextLength = extension_settings.cyoa.contextLength || 10;

    const recentMessages = chat.slice(-contextLength);

    let contextStr = '';

    // Add character card info
    const charData = getCharacterData();
    if (charData) {
        contextStr += `=== Character Card ===\n`;
        contextStr += `Name: ${charData.name}\n`;
        if (charData.description) {
            contextStr += `Description: ${charData.description}\n`;
        }
        if (charData.personality) {
            contextStr += `Personality: ${charData.personality}\n`;
        }
        if (charData.scenario) {
            contextStr += `Scenario: ${charData.scenario}\n`;
        }
        contextStr += '\n';
    }

    // Add user persona info
    const personaData = getUserPersonaData();
    if (personaData) {
        contextStr += `=== User Persona ===\n`;
        contextStr += `Name: ${personaData.name}\n`;
        contextStr += `Description: ${personaData.description}\n\n`;
    }

    // Add conversation
    contextStr += `=== Conversation ===\n`;
    contextStr += `Character: ${charName}\nUser: ${userName}\n\n`;

    for (const msg of recentMessages) {
        const name = msg.is_user ? userName : charName;
        const text = cleanMessageText(msg.mes || '');
        if (text.trim()) {
            contextStr += `${name}: ${text}\n\n`;
        }
    }

    return { contextStr, charName, userName };
}

async function generateCYOAOptions(messageId) {
    const settings = extension_settings.cyoa;

    if (!settings.enabled) {
        return;
    }

    if (!settings.apiEndpoint || !settings.apiKey) {
        console.warn('[CYOA] API endpoint or key not configured');
        return;
    }

    const messageElement = $(`.mes[mesid="${messageId}"]`);
    if (!messageElement.length) {
        return;
    }

    // Remove any existing CYOA container for this message
    messageElement.find('.cyoa-container').remove();

    // Add loading indicator
    const loadingHtml = `<div class="cyoa-container cyoa-loading" data-mesid="${messageId}">Generating options...</div>`;
    messageElement.find('.mes_block').append(loadingHtml);

    try {
        const { contextStr, charName, userName } = buildContext();

        // Prepare system prompt with substitutions
        let systemPrompt = settings.systemPrompt
            .replace(/\{n\}/g, settings.numberOfOptions.toString())
            .replace(/\{char\}/g, charName)
            .replace(/\{user\}/g, userName);

        // Build messages array
        const messages = [];

        // Inject preset prompts if enabled
        if (settings.usePreset && settings.uploadedPreset) {
            const presetPrompts = getUploadedPresetPrompts();
            if (presetPrompts.length > 0) {
                messages.push(...presetPrompts);
            }
        }

        // Add our system prompt and user message
        messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: contextStr });

        // Apply post-processing to messages
        const processedMessages = applyPostProcessing(messages, settings.postProcessing || 'none');

        // Build API endpoint URL
        let apiUrl = settings.apiEndpoint;
        if (!apiUrl.endsWith('/')) {
            apiUrl += '/';
        }
        if (!apiUrl.endsWith('v1/')) {
            apiUrl += 'v1/';
        }
        apiUrl += 'chat/completions';

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`,
            },
            body: JSON.stringify({
                model: settings.model,
                messages: processedMessages,
                temperature: 0.8,
                max_tokens: settings.maxTokens || 500,
            }),
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error('Empty response from API');
        }

        // Parse JSON array from response
        let options;
        try {
            // Try to extract JSON array from the response
            let jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                options = JSON.parse(jsonMatch[0]);
            } else {
                // Some models return {} instead of [], try to fix it
                const curlyMatch = content.match(/\{[\s\S]*\}/);
                if (curlyMatch) {
                    const parsed = JSON.parse(curlyMatch[0]);
                    // Handle numbered key objects like {"1": "opt1", "2": "opt2"}
                    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
                        options = Object.values(parsed);
                    } else {
                        options = parsed;
                    }
                } else {
                    throw new Error('No JSON array found in response');
                }
            }
        } catch (parseError) {
            console.error('[CYOA] Failed to parse options:', content);
            throw new Error('Failed to parse options from API response');
        }

        if (!Array.isArray(options) || options.length === 0) {
            throw new Error('Invalid options format');
        }

        // Normalize options - handle both string arrays and object arrays
        const normalizedOptions = options.map(opt => {
            if (typeof opt === 'string') return opt;
            if (typeof opt === 'object' && opt !== null) {
                // Handle {text: "..."} or {option: n, text: "..."} format
                return opt.text || opt.content || opt.message || opt.value || String(opt);
            }
            return String(opt);
        });

        // Render options
        renderOptions(messageId, normalizedOptions);

    } catch (error) {
        console.error('[CYOA] Error generating options:', error);

        // Show error message
        messageElement.find('.cyoa-container').remove();
        const errorHtml = `<div class="cyoa-container cyoa-error" data-mesid="${messageId}">Failed to generate options: ${error.message}</div>`;
        messageElement.find('.mes_block').append(errorHtml);
    }
}

function renderOptions(messageId, options) {
    const messageElement = $(`.mes[mesid="${messageId}"]`);
    if (!messageElement.length) {
        return;
    }

    // Remove loading indicator
    messageElement.find('.cyoa-container').remove();

    // Create options container
    let html = `<div class="cyoa-container" data-mesid="${messageId}">`;

    for (const option of options) {
        const escapedOption = option.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `<div class="cyoa-option-row">`;
        html += `<button class="cyoa-option" data-option="${escapedOption}">${escapedOption}</button>`;
        html += `<button class="cyoa-edit-btn" data-option="${escapedOption}" title="Edit before sending"><i class="fa-solid fa-pen"></i></button>`;
        html += `</div>`;
    }

    html += '</div>';

    messageElement.find('.mes_block').append(html);
}

async function onOptionClick(event) {
    const optionText = $(event.target).data('option');
    if (!optionText) {
        return;
    }

    // Remove all CYOA containers since we're moving to a new message
    $('.cyoa-container').remove();

    // Import Generate and sendMessageAsUser dynamically to avoid circular dependencies
    const { sendMessageAsUser, Generate } = await import('../../../../script.js');

    // Send the option as a user message
    await sendMessageAsUser(optionText, '');

    // Trigger AI response
    await Generate('normal');
}

async function onCharacterMessageRendered(messageId) {
    // Small delay to ensure DOM is ready
    await new Promise(resolve => setTimeout(resolve, 100));
    await generateCYOAOptions(messageId);
}

jQuery(async function () {
    // Load settings HTML
    const settingsHtml = await renderExtensionTemplateAsync(extensionName, 'settings');
    $('#extensions_settings').append(settingsHtml);

    // Load settings values
    loadSettings();

    // Bind event handlers for settings
    $('#cyoa_enabled').on('change', saveSettings);
    $('#cyoa_api_endpoint').on('input', saveSettings);
    $('#cyoa_api_key').on('input', saveSettings);
    $('#cyoa_model').on('input', saveSettings);

    $('#cyoa_num_options').on('input', saveSettings);
    $('#cyoa_context_length').on('input', saveSettings);
    $('#cyoa_max_tokens').on('input', saveSettings);
    $('#cyoa_use_preset').on('change', saveSettings);
    $('#cyoa_post_processing').on('change', saveSettings);
    $('#cyoa_preserved_tags').on('input', saveSettings);

    $('#cyoa_system_prompt').on('input', saveSettings);

    // Preset upload handlers
    $('#cyoa_preset_file').on('change', handlePresetUpload);
    $('#cyoa_preset_upload_btn').on('click', () => $('#cyoa_preset_file').trigger('click'));
    $('#cyoa_preset_clear_btn').on('click', clearUploadedPreset);

    // Bind click handler for CYOA options
    $(document).on('click', '.cyoa-option', onOptionClick);

    // Bind click handler for edit buttons - puts text in chat input
    $(document).on('click', '.cyoa-edit-btn', function(event) {
        const optionText = $(event.currentTarget).data('option');
        if (optionText) {
            $('#send_textarea').val(optionText).trigger('input');
            $('#send_textarea').focus();
        }
    });

    // Listen for character message rendered events
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);

    // Remove CYOA options when user sends their own message
    eventSource.on(event_types.USER_MESSAGE_RENDERED, () => {
        $('.cyoa-container').remove();
    });

    // Remove CYOA options when user swipes to a different message
    eventSource.on(event_types.MESSAGE_SWIPED, () => {
        $('.cyoa-container').remove();
    });

    console.log('[CYOA] Extension loaded');
});
