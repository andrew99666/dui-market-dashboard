export interface CityMetric {
  placeId: string;
  city: string;
  state: string;
  stateCode: string;
  totalSearchVolume: number;
  averageCpcUsd: number | null;
  latitude: number;
  longitude: number;
}

export interface UsPlace {
  placeId: string;
  city: string;
  state: string;
  stateCode: string;
  latitude: number;
  longitude: number;
}

export interface DatasetMetadata {
  refreshedAt: string;
  cpcThresholdUsd: number;
  volumeThreshold: number;
  keywordCount: number;
  sourceLabel: string;
  methodology: string;
}
