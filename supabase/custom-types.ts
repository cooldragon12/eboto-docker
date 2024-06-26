import type { Database } from "./types";

type Election = Database["public"]["Tables"]["elections"]["Row"];
type Position = Database["public"]["Tables"]["positions"]["Row"];
type Candidate = Database["public"]["Tables"]["candidates"]["Row"];

export type GeneratedElectionResult =
  Database["public"]["Tables"]["generated_election_results"]["Row"] & {
    election: Election & {
      logo_url: string | null;
      positions: (Position & {
        abstain_count: number;
        candidates: (Candidate & {
          vote_count: number;
        })[];
      })[];
    };
  };
