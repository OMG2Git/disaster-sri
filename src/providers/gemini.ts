import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { ExternalServiceError, type LocationExtractor } from './types.js';

const responseSchema = z.object({ location: z.string().nullable() });

const SYSTEM_PROMPT = `You extract the primary geographic location affected by a disaster from a text description.
Rules:
- Return ONLY the place name as written or clearly implied (e.g. "Manhattan, NYC").
- Do NOT invent a location. Do NOT output coordinates.
- If there is no reliable location, return null.`;

export class GeminiLocationExtractor implements LocationExtractor {
  private ai: GoogleGenAI;

  constructor(
    apiKey: string | undefined,
    private model: string,
    private timeoutMs: number,
  ) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required to run the location worker');
    this.ai = new GoogleGenAI({ apiKey });
  }

  async extractLocation(description: string): Promise<string | null> {
    let text: string | undefined;
    try {
      const response = await Promise.race([
        this.ai.models.generateContent({
          model: this.model,
          contents: description,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: { location: { type: Type.STRING, nullable: true } },
              required: ['location'],
            },
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timed out after ${this.timeoutMs}ms`)), this.timeoutMs * 3),
        ),
      ]);
      text = response.text;
    } catch (e) {
      throw new ExternalServiceError('gemini', e instanceof Error ? e.message : String(e));
    }

    try {
      const parsed = responseSchema.parse(JSON.parse(text ?? ''));
      const location = parsed.location?.trim();
      return location ? location : null;
    } catch {
      throw new ExternalServiceError('gemini', 'response was not the expected {"location": string|null} JSON');
    }
  }
}
