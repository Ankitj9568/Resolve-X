import { create } from 'zustand';
 
interface AuthState {
  token:    string | null;
  role:     string | null;
  setToken: (token: string) => void;
  setRole:  (role: string)  => void;
  clear:    ()              => void;
}
 
export const useAuthStore = create<AuthState>((set) => ({
  token:    null,
  role:     null,
  setToken: (token) => set({ token }),
  setRole:  (role)  => set({ role }),
  clear:    ()      => set({ token: null, role: null }),
}));