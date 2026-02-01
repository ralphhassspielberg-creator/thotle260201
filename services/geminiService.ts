
import { GoogleGenAI, Type, Modality, GenerateContentResponse } from "@google/genai";
import { Script, StoryElements, AnalyzedCharacter, SceneElement } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}
  
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const storyAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        characters: { type: Type.STRING, description: 'A description of the main characters, their personalities, and relationships.' },
        story: { type: Type.STRING, description: 'The core premise or background story of the series.' },
        today: { type: Type.STRING, description: 'A specific theme, setting, or event for this particular episode.' }
    },
    required: ['characters', 'story', 'today']
};

export async function analyzeStoryInputs(files: {name: string, content: string}[]): Promise<StoryElements> {
    if (files.length === 0) {
        throw new Error("No text or JSON files were provided to analyze for story elements.");
    }
    const fileContents = files.map(f => `--- FILE: ${f.name} ---\n${f.content}`).join('\n\n');

    const prompt = `You are a strict story analyst. Your task is to analyze the following text file contents and extract the key elements for a movie script.
    Identify the following three components based *only* on the provided text:
    1.  **Characters:** Who are the main characters? Describe them using only information from the files. **Crucially, you must not invent any characters or character traits.** If no characters are explicitly described, state that.
    2.  **Core Story:** What is the overall premise or background of the series?
    3.  **Daily Theme:** What is a specific theme, setting, or concept for today's episode?

    Your analysis must be strictly grounded in the provided files. Do not add any information that is not present. The list of characters must be limited to what is found in the text.

    Here are the file contents:
    ---
    ${fileContents}
    ---

    Return your analysis as a single JSON object conforming to the provided schema. Do not include any other text or markdown formatting.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: storyAnalysisSchema,
            },
        });

        const resultJson = response.text;
        if (!resultJson) {
            throw new Error("The model did not return an analysis.");
        }
        return JSON.parse(resultJson);

    } catch (error) {
        console.error("Error analyzing story inputs:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('API key not valid')) {
            throw new Error("Authentication failed. Please ensure your API key is correct and has the necessary permissions. The server returned a PERMISSION_DENIED error.");
        }
        throw new Error(`Could not analyze uploaded files. The model may have returned an invalid response or the content was insufficient. Details: ${errorMessage}`);
    }
}


const characterAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        characters: {
            type: Type.ARRAY,
            description: "A list of all characters found in the provided text.",
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "The character's name. Be precise." },
                    gender: { type: Type.STRING, enum: ['male', 'female', 'unknown'], description: "The character's gender, inferred from pronouns or explicit markers (m/f/male/female)." },
                    race: { type: Type.STRING, description: "The character's race or ethnicity, if mentioned (e.g., Black, White, Asian)." },
                    voiceDescription: { type: Type.STRING, description: "Any specific voice descriptions like 'white voiced' or 'Black voiced'." },
                    otherDescriptors: { type: Type.STRING, description: "Any other notable physical or personality descriptors found in the text." }
                },
                required: ['name', 'gender']
            }
        }
    },
    required: ['characters']
  };

export async function analyzeCharacterDescriptions(sourceText: string): Promise<AnalyzedCharacter[]> {
    const prompt = `You are an expert casting director. Your task is to read the following text and identify every character mentioned. Extract their details into a structured JSON format.

    Rules:
    - Identify each character's name.
    - Determine their gender ('male', 'female', or 'unknown') from context, pronouns, or markers like 'm' or 'f'.
    - Note their race/ethnicity if mentioned (e.g., Black, White, Asian).
    - Capture any specific descriptions of their voice (e.g., 'white voiced', 'Black voiced').
    - Collect any other physical or personality descriptors.
    - Consolidate information for each character. If 'JOHN' and 'John' appear, treat them as the same person.

    Here is the text to analyze:
    ---
    ${sourceText}
    ---

    Return your analysis as a single JSON object conforming to the provided schema. Do not include any other text or markdown formatting.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: characterAnalysisSchema,
            },
        });

        const resultJson = response.text;
        if (!resultJson) {
            throw new Error("The model did not return any character analysis.");
        }
        const parsed = JSON.parse(resultJson);
        return parsed.characters || [];

    } catch (error) {
        console.error("Error analyzing character descriptions:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('API key not valid')) {
            throw new Error("Authentication failed. Please ensure your API key is correct and has the necessary permissions. The server returned a PERMISSION_DENIED error.");
        }
        throw new Error(`Could not analyze character descriptions. Details: ${errorMessage}`);
    }
}

const scriptSchema = {
    type: Type.OBJECT,
    properties: {
        source_file: { type: Type.STRING, description: "The name of the source file, which should be 'gemini-3-pro-preview'." },
        title: { type: Type.STRING, description: "A creative and fitting title for the movie script." },
        scene_elements: {
            type: Type.ARRAY,
            description: "An array of scene elements that constitute the script.",
            items: {
                type: Type.OBJECT,
                properties: {
                    type: { type: Type.STRING, enum: ['scene_heading', 'action', 'dialogue_block', 'transition'] },
                    content: { type: Type.STRING, description: "The text content for scene_heading, action, or transition types." },
                    character: { type: Type.STRING, description: "The name of the character speaking (for dialogue_block)." },
                    elements: {
                        type: Type.ARRAY,
                        description: "An array of dialogue parts (for dialogue_block).",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                type: { type: Type.STRING, enum: ['parenthetical', 'dialogue'] },
                                content: { type: Type.STRING }
                            },
                            required: ['type', 'content']
                        }
                    }
                },
                required: ['type']
            }
        }
    },
    required: ['title', 'scene_elements']
};

export async function generateStory(prompt: string): Promise<Script> {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: scriptSchema,
            },
        });

        const resultJson = response.text;
        if (!resultJson) {
            throw new Error("The model did not return a script.");
        }
        const script = JSON.parse(resultJson) as Script;
        if (!script.source_file) {
            script.source_file = 'gemini-3-pro-preview';
        }
        return script;
    } catch (error) {
        console.error("Error generating story:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('API key not valid')) {
            throw new Error("Authentication failed. Please ensure your API key is correct and has the necessary permissions. The server returned a PERMISSION_DENIED error.");
        }
        throw new Error(`Failed to generate script. Details: ${errorMessage}`);
    }
}


const cohesivePromptsSchema = {
    type: Type.OBJECT,
    properties: {
        prompts: {
            type: Type.ARRAY,
            description: "An array of generated cohesive image prompts.",
            items: {
                type: Type.OBJECT,
                properties: {
                    sceneIndex: { type: Type.NUMBER, description: "The original index of the scene this prompt corresponds to." },
                    prompt: { type: Type.STRING, description: "The generated, detailed image prompt." },
                    characters: {
                        type: Type.ARRAY,
                        description: "A list of character names explicitly mentioned in this prompt.",
                        items: { type: Type.STRING }
                    }
                },
                required: ['sceneIndex', 'prompt', 'characters']
            }
        }
    },
    required: ['prompts']
};

export async function generateCohesiveImagePrompts(
    scenes: { sceneIndex: number; content: string }[],
    characterDescriptions: string,
    style: string
): Promise<{ sceneIndex: number; prompt: string; characters: string[] }[]> {
    const prompt = `You are a master storyboard artist. Your job is to convert simple action lines from a script into visually rich, cohesive image generation prompts.

    **CRITICAL INSTRUCTION: CHARACTER FIDELITY**
    You will be given a list of characters. Some are marked as **[MANDATORY VISUAL REFERENCE PROVIDED]**. Your highest priority is to ensure these specific characters appear in the generated image prompts. You MUST use them. If an action line is generic (e.g., "A character walks in"), you should choose one of the mandatory characters to feature. Use the provided names exactly.

    **Rules & Guidelines:**
    1.  **Visual Detail:** Transform each action line into a descriptive paragraph. Mention setting, lighting, mood, character actions, and expressions.
    2.  **Character Consistency:** Faithfully adhere to the character list below. Pay special attention to the mandatory characters.
    3.  **Visual Style:** All prompts must incorporate the following style: "${style || 'cinematic, photorealistic, high detail'}".
    4.  **Shot Composition:** For every prompt, describe a **medium shot**. This is critical to ensure character faces and upper bodies are clearly visible. Do not use close-ups or wide shots unless absolutely necessary for the narrative.
    5.  **Identify Characters:** For each prompt you generate, you must also return a list of the character names you included in that prompt.
    6.  **Cohesion:** The prompts should flow visually. Maintain consistent lighting and environments for scenes that occur in the same location.

    **Character List:**
    (Characters marked with [MANDATORY VISUAL REFERENCE PROVIDED] are the highest priority)
    ---
    ${characterDescriptions}
    ---

    **Action Lines to Convert:**
    ---
    ${JSON.stringify(scenes)}
    ---

    Now, generate the prompts based on these action lines. Return ONLY a JSON object that matches the provided schema. Do not include markdown or other text.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: cohesivePromptsSchema,
            },
        });
        const resultJson = response.text;
        if (!resultJson) {
            throw new Error("The model did not return cohesive prompts.");
        }
        const parsed = JSON.parse(resultJson);
        return parsed.prompts || [];
    } catch (error) {
        console.error("Error generating cohesive prompts:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('API key not valid')) {
            throw new Error("Authentication failed. Please ensure your API key is correct and has the necessary permissions. The server returned a PERMISSION_DENIED error.");
        }
        throw new Error(`Failed to generate cohesive image prompts. Details: ${errorMessage}`);
    }
}


export async function generateImage(
    prompt: string,
    characterImages?: { name: string, base64: string, mimeType: string }[],
    previousImageBase64?: string,
    style?: string,
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
): Promise<{ imageBase64: string | null; finalPrompt: string, wasRewritten: boolean }> {

    const finalPrompt = `Style: ${style || 'cinematic, photorealistic'}. ${prompt}`;
    
    const parts: any[] = [{ text: finalPrompt }];

    if (characterImages && characterImages.length > 0) {
        parts.push({ text: `\n\n[INSTRUCTIONS] Use the following provided images as a strong visual reference for the characters named: ${characterImages.map(c => c.name).join(', ')}. Maintain their appearance.` });
        characterImages.forEach(img => {
            parts.push({
                inlineData: {
                    data: img.base64,
                    mimeType: img.mimeType,
                },
            });
        });
    }

    if (previousImageBase64) {
        parts.push({ text: `\n\n[INSTRUCTIONS] Use the following image as a reference for visual continuity from the previous scene.` });
        parts.push({
            inlineData: {
                data: previousImageBase64,
                mimeType: 'image/png',
            },
        });
    }
    
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts },
            config: {
                imageConfig: {
                    aspectRatio: aspectRatio || "1:1"
                },
            },
        });

        let imageBase64: string | null = null;
        if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            for (const part of candidate.content.parts) {
                if (part.inlineData && part.inlineData.data) {
                    imageBase64 = part.inlineData.data;
                    break; 
                }
            }

            const wasRewritten = candidate.safetyRatings?.some(rating => rating.blocked) || false;

            return { imageBase64, finalPrompt, wasRewritten };
        }
        
        return { imageBase64: null, finalPrompt, wasRewritten: true };

    } catch (error) {
        console.error("Error generating image:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('SAFETY')) {
             return { imageBase64: null, finalPrompt, wasRewritten: true };
        }
        if (errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('API key not valid')) {
            throw new Error("Authentication failed. Please ensure your API key is correct and has the necessary permissions. The server returned a PERMISSION_DENIED error.");
        }
        throw new Error(`Failed to generate image. Details: ${errorMessage}`);
    }
}

/**
 * HS3000 DIALOGUE GENERATION SERVICE
 * Generates unique, single-sentence dialogue lines for each picture entry.
 * If a dialogue is reused, it generates increasingly meta/self-referential outtakes.
 */
const hs3000DialogueSchema = {
    type: Type.OBJECT,
    properties: {
        lines: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    character: { type: Type.STRING },
                    dialogue: { type: Type.STRING, description: "A single sentence of dialogue." }
                },
                required: ['character', 'dialogue']
            }
        }
    },
    required: ['lines']
};

export async function generateHS3000Dialogue(
    inputs: { character: string, originalDialogue: string, isDuplicate: boolean }[]
): Promise<{ character: string, dialogue: string }[]> {
    const prompt = `You are a meta-fictional writer for an AI-generated storyboard project. Your task is to process a list of dialogue requests for storyboard panels.

    **RULES:**
    1.  **Exactly One Sentence:** Every dialogue line must be exactly one sentence. No more.
    2.  **Duplicate Handling (META OUTTAKES):** If an input is marked as 'isDuplicate: true', do NOT repeat the original dialogue. Instead, generate a "meta outtake" where the character breaks the fourth wall or comments on the fact that they are in an AI-generated storyboard.
    3.  **Progression:** If there are multiple duplicates, make the meta-commentary increasingly self-referential and weird.
    4.  **Normal Lines:** If 'isDuplicate: false', just take the FIRST sentence of the original dialogue and use it.

    **INPUT DATA:**
    ---
    ${JSON.stringify(inputs)}
    ---

    Return the result as a JSON object matching the provided schema. Return ONLY the JSON.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: hs3000DialogueSchema,
            },
        });
        const resultJson = response.text;
        if (!resultJson) throw new Error("No dialogue returned.");
        const parsed = JSON.parse(resultJson);
        return parsed.lines || [];
    } catch (error) {
        console.error("Error generating HS3000 dialogue:", error);
        // Fallback: just return the first sentence of whatever we have
        return inputs.map(i => ({ 
            character: i.character, 
            dialogue: i.originalDialogue.split(/[.!?]/)[0] + "." 
        }));
    }
}
