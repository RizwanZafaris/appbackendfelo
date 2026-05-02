export type KycStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'needs_info';

export interface KycProfile {
  id: string;
  userId: string;
  fullName: string;
  dob?: string;
  nationality?: string;
  address?: string;
  status: KycStatus;
  reviewerId?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface KycDocument {
  id: string;
  profileId: string;
  type: KycDocType;
  fileUrl?: string;
  fileKey?: string;
  status: KycDocStatus;
  uploadedAt: Date;
  verifiedAt?: Date;
  reviewerNotes?: string;
}

export type KycDocType = 'passport' | 'id_card' | 'proof_of_address' | 'selfie' | 'driving_license';
export type KycDocStatus = 'pending' | 'verified' | 'rejected';

export interface KycReviewAction {
  status: Extract<KycStatus, 'approved' | 'rejected' | 'needs_info'>;
  notes?: string;
  reviewerId: string;
}

export interface KycRequirementConfig {
  country: string;
  requiredDocuments: KycDocType[];
  autoApproveThreshold?: number;
  reviewTimeoutHours: number;
}
