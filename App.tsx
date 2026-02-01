
import React, { useState, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
import { generateStory, analyzeStoryInputs, generateImage, generateCohesiveImagePrompts, analyzeCharacterDescriptions, generateHS3000Dialogue } from './services/geminiService';
import { Script, DialogueBlock, AnalyzedCharacter, StoryElements } from './types';
import Button from './components/Button';

type GeneratedImage = { sceneIndex: number; imageUrl: string, base64: string, prompt: string };
type CharacterImage = { fileName: string; base64: string; mimeType: string };
type TextFile = { name: string; content: string };
type GeneratedCharacterPortrait = { base64: string; mimeType: string, prompt: string };

/**
 * HS3000 DIALOGUE EXTRACTION UTILITIES
 * These functions are defined here to be easily referrable for future updates.
 */

/**
 * Finds the nearest dialogue block associated with a given scene index.
 * Searches forward until a scene heading is encountered, then searches backward.
 */
const getDialogueForScene = (sceneIndex: number, script: Script) => {
    // Search forward first
    for (let j = sceneIndex + 1; j < script.scene_elements.length; j++) {
        const el = script.scene_elements[j];
        if (el.type === 'scene_heading') break; 
        if (el.type === 'dialogue_block') {
             const dBlock = el as DialogueBlock;
             const spoken = dBlock.elements.find(e => e.type === 'dialogue')?.content;
             if (spoken) return { character: dBlock.character.toUpperCase(), dialogue: spoken, elementIndex: j };
        }
    }
    // If not found forward, search backward
    for (let j = sceneIndex - 1; j >= 0; j--) {
        const el = script.scene_elements[j];
        if (el.type === 'scene_heading') break;
        if (el.type === 'dialogue_block') {
             const dBlock = el as DialogueBlock;
             const spoken = dBlock.elements.find(e => e.type === 'dialogue')?.content;
             if (spoken) return { character: dBlock.character.toUpperCase(), dialogue: spoken, elementIndex: j };
        }
    }
    return null;
};

/**
 * HS3000 CONTENT GENERATOR
 * Uses pre-computed lines from state to build the final text file.
 */
const generateHs3000Content = (lines: {character: string, dialogue: string}[]): string => {
    return lines.map(line => `${line.character} "${line.dialogue}"`).join('\n');
};


// Levenshtein distance function for fuzzy string matching
const levenshteinDistance = (a: string, b: string): number => {
    const an = a ? a.length : 0;
    const bn = b ? b.length : 0;
    if (an === 0) return bn;
    if (bn === 0) return an;
    const matrix = Array(bn + 1).fill(null).map(() => Array(an + 1).fill(null));
    for (let i = 0; i <= an; i += 1) {
        matrix[0][i] = i;
    }
    for (let j = 0; j <= bn; j += 1) {
        matrix[j][0] = j;
    }
    for (let j = 1; j <= bn; j += 1) {
        for (let i = 1; i <= an; i += 1) {
            const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1, // deletion
                matrix[j - 1][i] + 1, // insertion
                matrix[j - 1][i - 1] + substitutionCost, // substitution
            );
        }
    }
    return matrix[bn][an];
};

const DownloadIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
);

const SparklesIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
);

const App: React.FC = () => {
    const [isGenerating, setIsGenerating] = useState<boolean>(false);
    const [isFileUploading, setIsFileUploading] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const [scriptData, setScriptData] = useState<Script | null>(null);
    const [stylePrompt, setStylePrompt] = useState<string>('');
    const [storyPrompt, setStoryPrompt] = useState<string>('');
    const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
    const [characterImages, setCharacterImages] = useState<Record<string, CharacterImage>>({});
    const [generatedCharacterPortraits, setGeneratedCharacterPortraits] = useState<Record<string, GeneratedCharacterPortrait>>({});
    const [textFiles, setTextFiles] = useState<TextFile[]>([]);
    const [generationReport, setGenerationReport] = useState<string>('');
    const [generationComplete, setGenerationComplete] = useState(false);
    const [isReadyForDownload, setIsReadyForDownload] = useState(false);
    const [hs3000Lines, setHs3000Lines] = useState<{character: string, dialogue: string}[]>([]);
    
    const handleFilesUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
    
        setIsFileUploading(true);
        setStatusMessage(`Reading ${files.length} file(s)...`);
        
        const processedImages: Record<string, CharacterImage> = {};
        const processedTexts: TextFile[] = [];
        const ignoredFiles: string[] = [];
    
        const fileProcessingPromises: Promise<void>[] = Array.from(files).map((file: File) => (async () => {
            const fileName = file.name.toLowerCase();
            
            if (fileName.endsWith('.zip')) {
                try {
                    setStatusMessage(`Unpacking ${file.name}...`);
                    const zip = await JSZip.loadAsync(file);
                    const zipEntryPromises: Promise<void>[] = [];
                    
                    zip.forEach((relativePath, zipEntry: any) => {
                        if (zipEntry.dir) return;
    
                        const entryPromise = (async () => {
                            const entryName = zipEntry.name;
                            const entryNameLower = entryName.toLowerCase();
                            const extension = entryNameLower.split('.').pop() || '';
    
                            try {
                                if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(extension)) {
                                    const base64 = await zipEntry.async('base64');
                                    const charName = entryName.split('/').pop()!.replace(/\.[^/.]+$/, "").toLowerCase();
                                    const mimeType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;
                                    processedImages[charName] = { fileName: entryName, base64, mimeType };
                                } else if (['txt', 'json', 'md'].includes(extension)) {
                                    const content = await zipEntry.async('string');
                                    processedTexts.push({ name: entryName, content });
                                } else {
                                    ignoredFiles.push(entryName);
                                }
                            } catch (e) {
                                console.warn(`Failed to process zip entry ${entryName}:`, e);
                                ignoredFiles.push(entryName);
                            }
                        })();
                        zipEntryPromises.push(entryPromise);
                    });
                    
                    await Promise.all(zipEntryPromises);
                } catch(e) {
                    console.error(`Error reading zip file ${file.name}:`, e);
                    ignoredFiles.push(file.name);
                }
            } else {
                const extension = fileName.split('.').pop() || '';
                try {
                    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(extension)) {
                        const base64 = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = e => resolve((e.target?.result as string).split(',')[1]);
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        });
                        const charName = file.name.replace(/\.[^/.]+$/, "").toLowerCase();
                        processedImages[charName] = { fileName: file.name, base64, mimeType: file.type || `image/${extension === 'jpg' ? 'jpeg' : extension}` };
                    } else if (['txt', 'json', 'md'].includes(extension)) {
                        const content = await file.text();
                        processedTexts.push({ name: file.name, content });
                    } else {
                        ignoredFiles.push(file.name);
                    }
                } catch (e) {
                    console.warn(`Failed to read file ${file.name}:`, e);
                    ignoredFiles.push(file.name);
                }
            }
        })());
    
        try {
            await Promise.all(fileProcessingPromises);
            
            setCharacterImages(prev => ({ ...prev, ...processedImages }));
            setTextFiles(prev => ([ ...prev, ...processedTexts ]));
    
            if (ignoredFiles.length > 0) {
                 setStatusMessage(`Processing complete. Ignored ${ignoredFiles.length} file(s).`);
            } else {
                 setStatusMessage('All files loaded successfully!');
            }
            setTimeout(() => setStatusMessage(''), 3000);
    
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred during file processing.";
            setError(`Failed to process files: ${errorMessage}`);
        } finally {
            setIsFileUploading(false);
            if(event.target) event.target.value = '';
        }
    }, []);

    const handleGenerate = useCallback(async () => {
        setIsGenerating(true);
        setError(null);
        setScriptData(null);
        setGeneratedImages([]);
        setGeneratedCharacterPortraits({});
        setGenerationReport('');
        setGenerationComplete(false);
        setIsReadyForDownload(false);
        setHs3000Lines([]);
        
        let report = '--- BOT THOTLE GENERATION REPORT ---\n\n';
        report += `Generation Date: ${new Date().toISOString()}\n\n`;

        try {
            let storyElements: StoryElements;
            let finalStoryPrompt = storyPrompt;

            if (textFiles.length === 0 && !storyPrompt && Object.keys(characterImages).length === 0) {
                finalStoryPrompt = "A lone astronaut discovers a strange, glowing artifact on a desolate moon.";
                report += 'NOTE: No inputs provided. Using a default story prompt to begin generation.\n\n';
            }
            
            if (textFiles.length > 0) {
                report += '--- SOURCE FILES ---\n';
                report += textFiles.map(f => ` - ${f.name}`).join('\n') + '\n\n';
                setStatusMessage('Analyzing uploaded files for story elements...');
                storyElements = await analyzeStoryInputs(textFiles);
            } else {
                report += '--- SOURCE FILES ---\n';
                report += 'No context files provided. Story elements will be inferred from the prompt.\n\n';
                storyElements = {
                    characters: 'To be determined by the writer based on the story prompt.',
                    story: 'To be determined by the writer based on the story prompt.',
                    today: 'To be determined by the writer based on the story prompt.'
                };
            }

            const styleFile = textFiles.find(f => f.name.toLowerCase() === 'style.txt');
            const finalStylePrompt = styleFile ? styleFile.content : stylePrompt;

            if (styleFile) {
                report += `NOTE: Using style.txt for style prompt.\n---\n${styleFile.content}\n---\n\n`;
            } else if (stylePrompt) {
                report += `--- STYLE PROMPT ---\nStyle: "${stylePrompt}"\n\n`;
            }

            const uploadedCharacterNames = Object.keys(characterImages);
            if (uploadedCharacterNames.length > 0) {
                report += '--- UPLOADED CHARACTERS ---\n';
                report += `The following characters were provided via image upload and must be included in the story: ${uploadedCharacterNames.join(', ')}\n\n`;
            }

            report += '--- STORY ANALYSIS ---\n';
            report += `Characters: ${storyElements.characters}\n`;
            report += `Core Story: ${storyElements.story}\n`;
            report += `Daily Theme: ${storyElements.today}\n`;
            report += `Inspirational Event: ${finalStoryPrompt}\n\n`;

            setStatusMessage('Constructing story prompt...');
            const finalPrompt = `You are a creative writer for a sci-fi comedy series. Your task is to write a new short movie script based on a series premise and a user-provided event.

**Series Premise:**
---
**Characters:**
${storyElements.characters}

**Core Story:**
${storyElements.story}

**Daily Theme:**
${storyElements.today}
---
${uploadedCharacterNames.length > 0 ? `
**Mandatory Characters:**
You MUST include characters named: ${uploadedCharacterNames.join(', ')}. These characters have visual references provided by the user. Integrate them naturally into the story.
---` : ''}

**Inspirational Event (Provided by User):**
---
${finalStoryPrompt}
---

Weave the essence of this user-provided event into your story. It should serve as the central conflict or comedic situation for the episode. How would the characters from your Series Premise (and the mandatory characters, if any) react to or cause a situation like this?

The final output must be a creative and engaging movie script. Return ONLY the JSON object conforming to the provided schema. Do not include any markdown formatting or any other text outside the JSON structure.
`;
            report += '--- SCRIPT GENERATION PROMPT ---\n';
            report += `${finalPrompt}\n\n`;

            setStatusMessage('Generating movie script...');
            const script = await generateStory(finalPrompt);
            setScriptData(script);
            report += '--- SCRIPT GENERATED SUCCESSFULLY ---\n\n';
            
            const charactersFile = textFiles.find(f => f.name.toLowerCase().includes('character'));
            const characterDescriptionSource = charactersFile ? charactersFile.content : storyElements.characters + '\n' + script.scene_elements.map(e => e.content || '').join('\n');
            setStatusMessage('Analyzing character descriptions...');
            report += '--- LLM CHARACTER ANALYSIS ---\n';
            const analyzedCharacters = await analyzeCharacterDescriptions(characterDescriptionSource);
            report += `LLM Analysis Result (JSON):\n${JSON.stringify(analyzedCharacters, null, 2)}\n\n`;
            
            // --- Character Portrait Generation ---
            setStatusMessage('Generating character portraits...');
            report += '--- CHARACTER PORTRAIT GENERATION ---\n\n';
            const newPortraits: Record<string, GeneratedCharacterPortrait> = {};
            const charactersToGenerate = analyzedCharacters.filter(char => !characterImages[char.name.toLowerCase().trim()]);
            
            const portraitPromises = charactersToGenerate.map(async (char, i) => {
                try {
                    setStatusMessage(`Generating portrait for ${char.name} (${i + 1}/${charactersToGenerate.length})...`);
                    const descriptorString = [char.race, char.gender, char.voiceDescription, char.otherDescriptors].filter(Boolean).join(', ');
                    const portraitPrompt = `Photorealistic, cinematic, full body portrait of a character named ${char.name}. Description: ${descriptorString}.`;
                    const imageGenResult = await generateImage(portraitPrompt, undefined, undefined, finalStylePrompt, '16:9');
                    
                    report += `[PORTRAIT ${i + 1}] Character: ${char.name}\n`;
                    report += `  - Prompt: "${imageGenResult.finalPrompt}"\n`;
                    report += `  - Status: ${imageGenResult.imageBase64 ? 'Success' : 'Failed'}\n\n`;

                    if (imageGenResult.imageBase64) {
                        const newPortrait = { base64: imageGenResult.imageBase64, mimeType: 'image/png', prompt: imageGenResult.finalPrompt };
                        newPortraits[char.name] = newPortrait;
                        setGeneratedCharacterPortraits(prev => ({...prev, [char.name]: newPortrait}));
                    }
                } catch (e) {
                    report += `[PORTRAIT ${i + 1}] Character: ${char.name} - GENERATION FAILED\n  - Error: ${e instanceof Error ? e.message : String(e)}\n\n`;
                }
            });
            await Promise.all(portraitPromises);

            const allAvailableCharacterImages: Record<string, { name: string, base64: string; mimeType: string }> = {};
            for (const [key, value] of Object.entries(characterImages)) { 
                const charImage = value as CharacterImage;
                allAvailableCharacterImages[key.toLowerCase()] = { name: key, ...charImage };
            }
            for (const [key, value] of Object.entries(newPortraits)) {
                allAvailableCharacterImages[key.toLowerCase()] = { name: key, ...(value as GeneratedCharacterPortrait) };
            }

            // --- Scene Image Generation ---
            report += '--- SCENE ASSET GENERATION LOG ---\n\n';
            const scenesWithAction = script.scene_elements
                .map((el, index) => ({ el, index }))
                .filter(({ el }) => el.type === 'action' && el.content);
            
            const scenesToGenerate = scenesWithAction.slice(0, 20);
            if (scenesWithAction.length > 20) {
                 report += `NOTE: Found ${scenesWithAction.length} actions with content, but limiting image generation to the first 20 to manage processing time.\n\n`;
            }

            setStatusMessage('Generating cohesive storyboard prompts...');
            
            // Get characters who have dialogue in the script
            const charactersInScriptDialogue = [...new Set(
                script.scene_elements
                    .filter(el => el.type === 'dialogue_block')
                    .map(el => (el as DialogueBlock).character.toUpperCase().trim())
            )];
    
            // Combine all known character names, ensuring uploaded ones are included
            const allKnownCharacterNames = [...new Set([...charactersInScriptDialogue, ...uploadedCharacterNames.map(name => name.toUpperCase().trim())])];
    
            // Build the description string for the prompt generator
            const allCharDescriptionsForPrompts = allKnownCharacterNames.map(charNameUpper => {
                const charData = analyzedCharacters.find(c => c.name.toUpperCase().trim() === charNameUpper);
                const description = charData ? ` (${[charData.race, charData.gender, charData.otherDescriptors].filter(Boolean).join(', ')})` : '';
                
                const originalName = Object.keys(characterImages).find(k => k.toUpperCase().trim() === charNameUpper) || 
                                     analyzedCharacters.find(c => c.name.toUpperCase().trim() === charNameUpper)?.name ||
                                     charNameUpper;
    
                const isMandatory = uploadedCharacterNames.some(upName => upName.toUpperCase().trim() === charNameUpper);
                
                return `${originalName}${description}${isMandatory ? ' [MANDATORY VISUAL REFERENCE PROVIDED]' : ''}`;
            }).join('; ');
            
            const cohesivePrompts = await generateCohesiveImagePrompts(
                scenesToGenerate.map(s => ({ sceneIndex: s.index, content: s.el.content || ''})),
                allCharDescriptionsForPrompts,
                finalStylePrompt
            );
            
            let previousImageBase64: string | undefined = undefined;
            const normalizeForMatch = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

            const finalGeneratedImages: GeneratedImage[] = [];

            for (let i = 0; i < cohesivePrompts.length; i++) {
                const { sceneIndex, prompt: imagePromptText, characters: charactersInPrompt } = cohesivePrompts[i];
                const actionElement = script.scene_elements[sceneIndex];
                let imageReport = '';
                try {
                    const actionContent = actionElement.content || '';
                    const characterImagesForGen: { name: string; base64: string; mimeType: string }[] = [];
                    let characterImagesUsedLog: string[] = [];

                    if (charactersInPrompt && charactersInPrompt.length > 0) {
                        for (const charName of charactersInPrompt) {
                            const normalizedCharName = normalizeForMatch(charName);
                            if (!normalizedCharName || Object.keys(allAvailableCharacterImages).length === 0) continue;

                            let bestMatchKey: string | null = null;
                            let minDistance = Infinity;
                            for (const key of Object.keys(allAvailableCharacterImages)) {
                                const normalizedKey = normalizeForMatch(key);
                                const distance = levenshteinDistance(normalizedCharName, normalizedKey);
                                if (distance < minDistance) {
                                    minDistance = distance;
                                    bestMatchKey = key;
                                }
                            }
                            if (bestMatchKey && (minDistance / Math.max(normalizedCharName.length, normalizeForMatch(bestMatchKey).length)) < 0.5) {
                                const matchedImage = allAvailableCharacterImages[bestMatchKey];
                                characterImagesForGen.push({
                                    name: matchedImage.name,
                                    base64: matchedImage.base64,
                                    mimeType: matchedImage.mimeType
                                });
                                characterImagesUsedLog.push(`${matchedImage.name} (Match for: ${charName}, dist: ${minDistance})`);
                            }
                        }
                    }

                    setStatusMessage(`Generating scene image ${i + 1} of ${cohesivePrompts.length}...`);
                    
                    const imageGenResult = await generateImage(imagePromptText, characterImagesForGen, previousImageBase64, finalStylePrompt, '16:9');
                    
                    imageReport += `[IMAGE ${i + 1}/${cohesivePrompts.length}] Scene Index: ${sceneIndex}\n`;
                    imageReport += `  - Source Action: "${actionContent}"\n`;
                    imageReport += `  - Cohesive Prompt: "${imagePromptText}"\n`;
                    imageReport += `  - Character Images Used: ${characterImagesUsedLog.length > 0 ? characterImagesUsedLog.join(', ') : 'None'}\n`;
                    imageReport += `  - Previous Scene Used for Continuity: ${previousImageBase64 ? 'Yes' : 'No'}\n`;
                    imageReport += `  - Final Prompt Sent: "${imageGenResult.finalPrompt}"\n`;
                    imageReport += `  - Was Rewritten For Safety: ${imageGenResult.wasRewritten}\n`;
                    imageReport += `  - Generation Status: ${imageGenResult.imageBase64 ? 'Success' : 'Failed'}\n\n`;

                    if (imageGenResult.imageBase64) {
                        const newImg = { 
                            sceneIndex, 
                            imageUrl: `data:image/png;base64,${imageGenResult.imageBase64}`, 
                            base64: imageGenResult.imageBase64,
                            prompt: imageGenResult.finalPrompt
                        };
                        finalGeneratedImages.push(newImg);
                        setGeneratedImages(prev => [...prev, newImg]);
                        previousImageBase64 = imageGenResult.imageBase64;
                    }
                    report += imageReport;
                } catch (e) {
                    imageReport += `[IMAGE ${i + 1}/${cohesivePrompts.length}] Scene Index: ${sceneIndex} - GENERATION FAILED\n  - Error: ${e instanceof Error ? e.message : String(e)}\n\n`;
                    report += imageReport;
                }
            }

            // --- Secondary Dialogue Processing (HS3000) ---
            setStatusMessage('Generating unique HS3000 dialogue entries...');
            const dialogueInputs: { character: string, originalDialogue: string, isDuplicate: boolean }[] = [];
            const seenDialogueIndices = new Set<number>();

            for (const img of finalGeneratedImages) {
                const diag = getDialogueForScene(img.sceneIndex, script);
                if (diag) {
                    const isDuplicate = seenDialogueIndices.has(diag.elementIndex);
                    dialogueInputs.push({
                        character: diag.character,
                        originalDialogue: diag.dialogue,
                        isDuplicate: isDuplicate
                    });
                    seenDialogueIndices.add(diag.elementIndex);
                }
            }

            if (dialogueInputs.length > 0) {
                const lines = await generateHS3000Dialogue(dialogueInputs);
                setHs3000Lines(lines);
                report += '--- HS3000 DIALOGUE GENERATED ---\n';
                report += lines.map(l => `${l.character}: "${l.dialogue}"`).join('\n') + '\n\n';
            }
            
            setGenerationReport(report);
            setGenerationComplete(true);
    
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during asset generation.';
            setError(errorMessage);
            console.error("Asset Generation Error:", err);
            setGenerationReport(prev => prev + `--- GENERATION FAILED ---\n\nError: ${errorMessage}\n`);
        } finally {
            setIsGenerating(false);
            setStatusMessage('');
            setIsReadyForDownload(true);
        }
    }, [textFiles, characterImages, stylePrompt, storyPrompt]);

    const handleStartOver = () => {
        setScriptData(null);
        setGeneratedImages([]);
        setCharacterImages({});
        setGeneratedCharacterPortraits({});
        setTextFiles([]);
        setStylePrompt('');
        setStoryPrompt('');
        setError(null);
        setStatusMessage('');
        setIsGenerating(false);
        setIsFileUploading(false);
        setGenerationReport('');
        setGenerationComplete(false);
        setIsReadyForDownload(false);
        setHs3000Lines([]);
    };
    
    const scriptToText = (script: Script | null): string => {
        if (!script) return "";
        let text = `Title: ${script.title}\n\n`;
        script.scene_elements.forEach(el => {
            switch(el.type) {
                case 'scene_heading': text += `${el.content}\n\n`; break;
                case 'action': text += `${el.content}\n\n`; break;
                case 'transition': text += `${el.content}\n\n`; break;
                case 'dialogue_block':
                    if ('character' in el && 'elements' in el) {
                       text += `\t${el.character.toUpperCase()}\n`;
                        el.elements.forEach(diag => {
                           text += diag.type === 'parenthetical' ? `\t(${diag.content})\n` : `\t${diag.content}\n`;
                        });
                        text += '\n'; 
                    }
                    break;
            }
        });
        return text;
    };

    const handleDownloadZip = useCallback(async () => {
        if (!scriptData) return;
        setError(null);
        try {
            const zip = new JSZip();
            zip.file('script.json', JSON.stringify(scriptData, null, 2));
            zip.file('story.txt', scriptToText(scriptData));
            zip.file('generation_report.txt', generationReport);
            
            // Generate the requested 0hs3000 summary file
            const now = new Date();
            const timeStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
            const safeTitle = scriptData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const hs3000Filename = `0hs3000_${safeTitle}_${timeStr}.txt`;
            const hs3000Content = generateHs3000Content(hs3000Lines);
            zip.file(hs3000Filename, hs3000Content);

            const imageFolder = zip.folder("images");
            if (imageFolder) {
                for(let i = 0; i < generatedImages.length; i++) {
                    const img = generatedImages[i];
                    const fileName = `scene_${String(img.sceneIndex).padStart(4, '0')}.png`;
                    const txtFileName = `scene_${String(img.sceneIndex).padStart(4, '0')}.txt`;
                    
                    const diag = hs3000Lines[i];
                    let dialogueText = diag ? `${diag.character}: ${diag.dialogue}` : "";

                    let fileContent = img.prompt;
                    if (dialogueText) {
                        fileContent += `\n\n${dialogueText}`;
                    }

                    imageFolder.file(fileName, img.imageUrl.split(',')[1], {base64: true});
                    imageFolder.file(txtFileName, fileContent);
                }

                const charFolder = imageFolder.folder("characters");
                if (charFolder) {
                    for (const [name, image] of Object.entries(generatedCharacterPortraits)) {
                        const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                        const fileName = `${safeName}.png`;
                        const txtFileName = `${safeName}.txt`;
                        charFolder.file(fileName, (image as GeneratedCharacterPortrait).base64, { base64: true });
                        charFolder.file(txtFileName, (image as GeneratedCharacterPortrait).prompt);
                    }
                }
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `${safeTitle}_assets.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(`Failed to create zip file: ${errorMessage}`);
        }
    }, [scriptData, generatedImages, generationReport, generatedCharacterPortraits, hs3000Lines]);
    
    useEffect(() => {
        if (generationComplete && isReadyForDownload) {
            handleDownloadZip();
            setGenerationComplete(false); 
        }
    }, [generationComplete, isReadyForDownload, handleDownloadZip]);


    const renderInitialForm = () => (
        <div className="text-center animate-fade-in">
            <div className="my-8 p-6 border-2 border-dashed border-slate-600 hover:border-sky-500 bg-slate-800/50 rounded-lg transition-colors">
                <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center justify-center">
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-slate-500 mb-2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                    </svg>
                    <span className="text-lg font-semibold text-sky-400">Batch Upload Files or a .ZIP</span>
                    <p className="text-sm text-slate-400 mt-1">Select all text & image files</p>
                </label>
                <input id="file-upload" type="file" multiple className="hidden" onChange={handleFilesUpload} disabled={isFileUploading || isGenerating} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                <div>
                    {textFiles.length > 0 && <h4 className="font-semibold mb-3 text-lg">Story Files:</h4>}
                    <ul className="space-y-2">
                        {textFiles.map((file, index) => (
                           <li key={`${file.name}-${index}`} className={`flex items-center p-2 rounded-md text-sm ${file.name.toLowerCase() === 'style.txt' ? 'bg-sky-900/50' : 'bg-slate-700'}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-3 text-slate-400"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a" />
                                </svg>
                               <span className="truncate">{file.name}</span>
                           </li>
                        ))}
                    </ul>
                </div>
                 <div>
                    {Object.keys(characterImages).length > 0 && <h4 className="font-semibold mb-3 text-lg">Character Images:</h4>}
                    <ul className="space-y-2">
                        {Object.entries(characterImages).map(([name, charImage]) => (
                            <li key={name} className="flex items-center p-2 bg-slate-700 rounded-md text-sm">
                                <img src={`data:${(charImage as CharacterImage).mimeType};base64,${(charImage as CharacterImage).base64}`} alt={name} className="w-8 h-8 rounded-full object-cover mr-3" />
                                <span className="truncate">{(charImage as CharacterImage).fileName}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <div className="mt-10">
                <Button onClick={handleGenerate} isLoading={isGenerating} disabled={isFileUploading || isGenerating} icon={<SparklesIcon />}>
                    Generate Episode
                </Button>
            </div>
        </div>
    );

    const renderProcessing = () => (
         <div className="text-center animate-fade-in">
            <h2 className="text-2xl font-bold mb-4">Generating Your Episode...</h2>
            <div className="flex items-center justify-center space-x-3 my-8">
                 <div className="w-4 h-4 bg-sky-400 rounded-full animate-pulse [animation-delay:-0.3s]"></div>
                 <div className="w-4 h-4 bg-sky-400 rounded-full animate-pulse [animation-delay:-0.15s]"></div>
                 <div className="w-4 h-4 bg-sky-400 rounded-full animate-pulse"></div>
            </div>
            <p className="text-slate-400 mb-6">{statusMessage}</p>

            {Object.keys(generatedCharacterPortraits).length > 0 && (
                <div className="mt-6">
                    <h3 className="text-lg font-semibold text-slate-300 mb-4">Generated Characters</h3>
                    <div className="flex flex-wrap justify-center gap-4">
                        {Object.entries(generatedCharacterPortraits).map(([name, image]) => (
                            <div key={name} className="text-center animate-fade-in">
                                <img src={`data:${(image as GeneratedCharacterPortrait).mimeType};base64,${(image as GeneratedCharacterPortrait).base64}`} alt={name} className="w-48 h-auto aspect-video rounded-lg object-cover mx-auto border-2 border-slate-600 shadow-lg" />
                                <p className="text-sm mt-2 text-slate-400">{name}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );

    const renderResults = () => (
        <div className="w-full max-w-4xl mx-auto animate-fade-in">
            <h2 className="text-3xl font-bold mb-2 text-center">{scriptData?.title || 'Generation Complete'}</h2>
            <p className="text-slate-400 mb-8 text-center">Your script and assets have been generated.</p>

            <div className="flex justify-center items-center gap-4 mb-8">
                <Button onClick={handleDownloadZip} disabled={!isReadyForDownload} icon={<DownloadIcon />}>
                    Download .ZIP
                </Button>
            </div>

            <div className="bg-slate-800 p-6 rounded-lg shadow-lg">
                <h3 className="text-xl font-semibold mb-4 border-b border-slate-700 pb-2">Generation Report</h3>
                <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono bg-slate-900 p-4 rounded-md h-96 overflow-y-auto">{generationReport}</pre>
            </div>
            <div className="text-center mt-8">
                <button onClick={handleStartOver} className="text-sky-400 hover:text-sky-300 font-medium transition-colors">
                    Start Over
                </button>
            </div>
        </div>
    );

    const renderContent = () => {
        if (isGenerating) return renderProcessing();
        if (scriptData) return renderResults();
        return renderInitialForm();
    };

    return (
        <main className="container mx-auto px-4 py-12 min-h-screen flex flex-col items-center justify-center">
            <div className="text-center mb-10">
                 <h1 className="text-5xl font-extrabold tracking-tight text-white sm:text-6xl md:text-7xl">
                    <span className="text-sky-400">BOT</span> THOTLE
                </h1>
                <p className="mt-4 text-lg text-slate-300 max-w-2xl mx-auto">AI-Powered Storyboard & Script Generator</p>
            </div>

            <div className="w-full max-w-4xl bg-slate-800/50 p-8 rounded-2xl shadow-2xl border border-slate-700">
                {error && (
                     <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg relative mb-6" role="alert">
                        <strong className="font-bold">Error: </strong>
                        <span className="block sm:inline">{error}</span>
                        <button onClick={() => setError(null)} className="absolute top-0 bottom-0 right-0 px-4 py-3" aria-label="Close">
                           <svg className="fill-current h-6 w-6 text-red-400" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
                        </button>
                    </div>
                )}
                {renderContent()}
            </div>
             <footer className="text-center text-slate-500 mt-10 text-sm">
                <p>Provide prompts and upload files to begin the creative process.</p>
            </footer>
        </main>
    );
};

export default App;
