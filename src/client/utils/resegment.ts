import type { Segment, Word } from "../types";

export function resegmentByWordCount(words: Word[], maxWords: number): Segment[] {
    if (!words || words.length === 0) {
        return [];
    }

    const newSegments: Segment[] = [];
    let currentWords: Word[] = [];

    for (let i = 0; i < words.length; i++) {
        currentWords.push(words[i]);

        if (currentWords.length >= maxWords || i === words.length - 1) {
            const start = currentWords[0].start;
            const end = currentWords[currentWords.length - 1].end;
            const text = currentWords.map((w) => w.word).join(" ");

            newSegments.push({
                id: Date.now() + i, // Unique ID generation
                start,
                end,
                text,
            });

            currentWords = [];
        }
    }

    return newSegments;
}
