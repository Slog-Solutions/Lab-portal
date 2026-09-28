import { Injectable } from '@nestjs/common';
import { ActivityType, ItemType } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { DictionaryStoreService } from './dictionary-store.service';

/** Escapes a word for safe use inside a RegExp, then masks every whole-word
 * occurrence of it in a definition — spec §6: "prompt = first definition
 * (headword and forms masked as ____)". Word-boundary + case-insensitive so
 * "Run" and "run" both mask inside a definition that happens to capitalize
 * it at a sentence start. */
function maskWord(definition: string, word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return definition.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '____');
}

/**
 * Spec §8's "add these to an item bank" — turns a teacher's picked list
 * of looked-up words into a real VOCABULARY_TEST exercise, bank mode
 * (config.itemBankId), matching how AssessmentsService.create wires a
 * Vocabulary Test from "Create Assignment" — one atomic transaction, no
 * intermediate state an interrupted call could leave half-wired.
 */
@Injectable()
export class DictionaryExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: DictionaryStoreService,
  ) {}

  async exportToItemBank(teacherId: string, title: string, words: string[]): Promise<{ exerciseId: string; itemCount: number }> {
    const uniqueWords = Array.from(new Set(words.map((w) => w.trim()).filter(Boolean)));
    const items = uniqueWords.map((word) => ({ prompt: this.buildPrompt(word), answer: word }));

    const exercise = await this.prisma.$transaction(async (tx) => {
      const created = await tx.exercise.create({ data: { teacherId, type: ActivityType.VOCABULARY_TEST, title, config: {} } });
      const bank = await tx.itemBank.create({ data: { exerciseId: created.id } });
      await tx.item.createMany({
        data: items.map((item, order) => ({
          itemBankId: bank.id,
          order,
          type: ItemType.SHORT_ANSWER,
          prompt: item.prompt,
          answer: item.answer,
          choices: [],
        })),
      });
      await tx.exercise.update({
        where: { id: created.id },
        data: { config: { itemBankId: bank.id, shuffleItems: true } },
      });
      return created;
    });

    return { exerciseId: exercise.id, itemCount: items.length };
  }

  /** The dictionary's own first sense definition for the word, with the
   * word itself masked out — or just the bare word when the dictionary is
   * unavailable or has no entry for it (a teacher can still edit the
   * prompt afterwards from the exercise's item bank). */
  private buildPrompt(word: string): string {
    if (!this.store.isAvailable()) return word;
    const entry = this.store.findAllByHeadword(word.toLowerCase())[0];
    if (!entry) return word;
    const firstSense = this.store.sensesForEntry(entry.id)[0];
    if (!firstSense) return word;
    return maskWord(firstSense.definition, word);
  }
}
