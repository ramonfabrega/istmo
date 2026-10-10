export interface Report {
  id: string;
  source: string;
  source_id: string;
  occurred_at: number;
  latitude: number;
  longitude: number;
  depth: number;
  magnitude: number;
  magnitude_type: string | null;
  place: string;
  status: string;
  url: string;
  first_seen: number;
  new_report_at: number | null;
  updated_at: number;
  revision: number;
  fingerprint: string;
}
export interface Source {
  id: string;
  name: string;
  url: string;
  last_attempt: number | null;
  last_success: number | null;
  error: string | null;
  report_count: number;
}
export interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  mode: "replay" | "live";
  description: string;
  last_received: number | null;
  last_sample: number | null;
}
export interface WaveMeta {
  type: "record";
  station: string;
  session: string;
  sequence: number;
  start: number;
  originalStart: number;
  sampleRate: number;
  sampleCount: number;
  channel: string;
  receivedAt: number;
  mode: "replay" | "live";
  gap?: boolean;
}
export interface Person {
  id: string;
  name: string;
}
export interface Checkin {
  id: string;
  person_id: string;
  reporter_id: string;
  reporter_name: string;
  context: string;
  meeting_point: string;
  kind: "status" | "presence";
  value: string;
  note: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  located_at: number | null;
  contacted_at: number;
  created_at: number;
}
export interface GatheringPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  created_by: string;
  created_at: number;
}
export interface Family {
  group: {
    id: string;
    name: string;
    meeting_point: string;
  };
  member: {
    id: string;
    name: string;
    person_id: string;
    role: "owner" | "member";
  };
  people: Person[];
  checkins: Checkin[];
  places: GatheringPlace[];
}
