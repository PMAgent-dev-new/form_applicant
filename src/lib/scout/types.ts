export type Candidate = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  region: string;
  qualifications: string;
  status: string;
  appliedAt: string | null;
  consentDate: number | null;
  consentMethod: string;
  emailStopped: boolean;
  stopKnown: boolean;
  isTest: boolean;
};
export type ConsentEvidence = {
  source: string;
  submissionId: string;
  email: string;
  phone: string;
  recordedAt: string;
  consent: unknown;
  isTest: boolean;
};
export type Staff = { id: string; email: string; display_name: string };
export type ScoutJob = {
  id: string;
  title: string;
  company: string;
  region: string;
  url: string;
  updatedAt: string;
  category?: string;
  work?: string;
  requirements?: string;
};
export type Eligibility = {
  allowed: boolean;
  reasons: string[];
  evidence?: ConsentEvidence;
};
export type ScoutMessage = {
  id: string;
  staff_id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_snapshot: Candidate;
  email: string;
  contact_keys: string[];
  job_id: string;
  job_snapshot: ScoutJob;
  subject: string;
  body: string;
  from_email: string;
  reply_to: string;
  consent_snapshot: unknown;
  status: "draft" | "sending" | "accepted" | "unknown";
  provider_id: string | null;
  created_at: string;
  expires_at: string;
  sent_at: string | null;
  outcome: "none" | "replied" | "meeting" | "declined";
  batch_id?: string | null;
  batch_index?: number | null;
};

// 管理画面に同意原本・連絡先キー・内部スナップショットを返さない。
export type ScoutMessageView = Pick<
  ScoutMessage,
  | "id"
  | "candidate_name"
  | "email"
  | "subject"
  | "from_email"
  | "reply_to"
  | "status"
  | "provider_id"
  | "created_at"
  | "sent_at"
  | "outcome"
  | "batch_index"
> & { body?: string };
