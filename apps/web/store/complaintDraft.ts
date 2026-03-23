import { create } from 'zustand';
 
interface ComplaintDraftState {
  // Screen 1
  category:    string | null;
  subcategory: string | null;
  // Screen 2
  latitude:    number | null;
  longitude:   number | null;
  // Screen 3
  fileUrls:    string[];
  // Screen 4
  description: string;
 
  setField: <K extends keyof Omit<ComplaintDraftState, 'setField' | 'reset'>>(
    key: K,
    value: ComplaintDraftState[K]
  ) => void;
  reset: () => void;
}
 
const INITIAL: Omit<ComplaintDraftState, 'setField' | 'reset'> = {
  category:    null,
  subcategory: null,
  latitude:    null,
  longitude:   null,
  fileUrls:    [],
  description: '',
};
 
export const useComplaintDraft = create<ComplaintDraftState>((set) => ({
  ...INITIAL,
  setField: (key, value) => set({ [key]: value }),
  reset:    ()           => set(INITIAL),
}));