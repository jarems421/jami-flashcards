import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';

// Types
export type NoteType = 'basic' | 'cloze' | 'image-occlusion';

export interface Note {
  id: string;
  type: NoteType;
  content: {
    front?: string;
    back?: string;
    text?: string; // For cloze
    imageUrl?: string; // For occlusion
    occlusions?: { id: string; x: number; y: number; width: number; height: number }[];
  };
  tags: string[];
  createdAt: number;
}

export interface Card {
  id: string;
  noteId: string;
  state: 'new' | 'learning' | 'review' | 'relearning';
  due: number; // Timestamp
  interval: number; // Minutes
  ease: number; // Multiplier
  lapses: number;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  timestamp: number;
  duration: number; // ms
}

interface StoreState {
  notes: Record<string, Note>;
  cards: Record<string, Card>;
  logs: ReviewLog[];
  
  addNote: (note: Omit<Note, 'id' | 'createdAt'>, cardTemplates: any[]) => void;
  answerCard: (cardId: string, rating: ReviewLog['rating']) => void;
  getDueCards: () => Card[];
}

// Initial Mock Data
const INITIAL_NOTES: Record<string, Note> = {
  'n1': {
    id: 'n1',
    type: 'basic',
    content: { front: 'What is the capital of France?', back: 'Paris' },
    tags: ['geography'],
    createdAt: Date.now(),
  },
  'n2': {
    id: 'n2',
    type: 'basic',
    content: { front: 'What is the powerhouse of the cell?', back: 'Mitochondria' },
    tags: ['biology'],
    createdAt: Date.now(),
  },
  'n3': {
    id: 'n3',
    type: 'basic',
    content: { front: 'Define "Closure" in JavaScript', back: 'A closure is the combination of a function bundled together (enclosed) with references to its surrounding state (the lexical environment).' },
    tags: ['coding', 'javascript'],
    createdAt: Date.now(),
  }
};

const INITIAL_CARDS: Record<string, Card> = {
  'c1': { id: 'c1', noteId: 'n1', state: 'new', due: Date.now(), interval: 0, ease: 2.5, lapses: 0 },
  'c2': { id: 'c2', noteId: 'n2', state: 'review', due: Date.now() - 100000, interval: 1440, ease: 2.6, lapses: 0 },
  'c3': { id: 'c3', noteId: 'n3', state: 'new', due: Date.now(), interval: 0, ease: 2.5, lapses: 0 },
};

// Store Implementation
export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      notes: INITIAL_NOTES,
      cards: INITIAL_CARDS,
      logs: [],

      addNote: (noteData, _cardTemplates) => {
        const noteId = uuidv4();
        const note: Note = {
          ...noteData,
          id: noteId,
          createdAt: Date.now(),
        };

        // Simplified card generation logic for prototype
        const cardId = uuidv4();
        const card: Card = {
          id: cardId,
          noteId,
          state: 'new',
          due: Date.now(),
          interval: 0,
          ease: 2.5,
          lapses: 0,
        };

        set((state) => ({
          notes: { ...state.notes, [noteId]: note },
          cards: { ...state.cards, [cardId]: card },
        }));
      },

      answerCard: (cardId, rating) => {
        set((state) => {
          const card = state.cards[cardId];
          if (!card) return state;

          // Simple SM-2ish mock scheduling
          let newInterval = card.interval;
          let newEase = card.ease;
          let newState = card.state;
          const now = Date.now();

          if (rating === 'again') {
            newInterval = 1; // 1 min
            newState = 'learning';
            // Ease drops on fail
            newEase = Math.max(1.3, newEase - 0.2);
          } else if (rating === 'hard') {
            newInterval = Math.max(1, newInterval * 1.2);
            newEase = Math.max(1.3, newEase - 0.15);
             newState = 'review';
          } else if (rating === 'good') {
            newInterval = card.state === 'new' ? 10 : Math.max(1, newInterval * newEase);
            newState = 'review';
          } else if (rating === 'easy') {
            newInterval = card.state === 'new' ? 1440 * 4 : Math.max(1, newInterval * newEase * 1.3);
            newEase += 0.15;
            newState = 'review';
          }

          const updatedCard: Card = {
            ...card,
            interval: newInterval,
            ease: newEase,
            state: newState,
            due: now + (newInterval * 60 * 1000), // Interval is in minutes
          };

          const log: ReviewLog = {
            id: uuidv4(),
            cardId,
            rating,
            timestamp: now,
            duration: 0, // Mock
          };

          return {
            cards: { ...state.cards, [cardId]: updatedCard },
            logs: [...state.logs, log],
          };
        });
      },

      getDueCards: () => {
        const { cards } = get();
        const now = Date.now();
        return Object.values(cards)
          .filter(c => c.due <= now)
          .sort((a, b) => a.due - b.due);
      },
    }),
    {
      name: 'flashrecall-storage',
    }
  )
);
