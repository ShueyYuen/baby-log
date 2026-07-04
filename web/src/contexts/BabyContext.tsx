import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { api } from '../lib/api';

interface Baby {
  id: string;
  name: string;
  gender: string;
  birthDate: string;
  avatar?: string;
}

interface BabyContextValue {
  babies: Baby[];
  currentBaby: Baby | null;
  setCurrentBaby: (baby: Baby) => void;
  refreshBabies: () => Promise<void>;
}

const BabyContext = createContext<BabyContextValue | null>(null);

export function BabyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [babies, setBabies] = useState<Baby[]>([]);
  const [currentBaby, setCurrentBaby] = useState<Baby | null>(null);

  const refreshBabies = async () => {
    if (!user) return;
    try {
      const res = await api.get<{ success: boolean; data: Baby[] }>('/babies');
      setBabies(res.data);
      const savedId = localStorage.getItem('currentBabyId');
      const found = res.data.find((b) => b.id === savedId);
      if (found) setCurrentBaby(found);
      else if (res.data.length > 0) setCurrentBaby(res.data[0]);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshBabies();
  }, [user]);

  const selectBaby = (baby: Baby) => {
    setCurrentBaby(baby);
    localStorage.setItem('currentBabyId', baby.id);
  };

  return (
    <BabyContext.Provider value={{ babies, currentBaby, setCurrentBaby: selectBaby, refreshBabies }}>
      {children}
    </BabyContext.Provider>
  );
}

export function useBaby() {
  const ctx = useContext(BabyContext);
  if (!ctx) throw new Error('useBaby must be used within BabyProvider');
  return ctx;
}
