import { Droplets, Hospital, House, LifeBuoy, Utensils, type LucideIcon } from 'lucide-react';
import type { ResourceType } from '../types';

export const RESOURCE_META: Record<ResourceType, { label: string; icon: LucideIcon; color: string }> = {
  SHELTER: { label: 'Shelter', icon: House, color: '#3b82f6' },
  HOSPITAL: { label: 'Hospital', icon: Hospital, color: '#ef4444' },
  FOOD: { label: 'Food', icon: Utensils, color: '#f59e0b' },
  WATER: { label: 'Water', icon: Droplets, color: '#06b6d4' },
  RESCUE: { label: 'Rescue', icon: LifeBuoy, color: '#8b5cf6' },
};
