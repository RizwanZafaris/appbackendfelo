export type KybStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'needs_info';

export interface KybBusiness {
  id: string;
  businessName: string;
  registrationNumber: string;
  country: string;
  businessType: string;
  tradeLicense?: string;
  incorporationDate?: string;
  address?: string;
  website?: string;
  status: KybStatus;
  reviewerId?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface KybUbo {
  id: string;
  businessId: string;
  fullName: string;
  dob?: string;
  nationality?: string;
  ownershipPercentage: number;
  kycProfileId?: string;
  status: KybStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface KybBusinessDoc {
  id: string;
  businessId: string;
  type: KybDocType;
  fileUrl?: string;
  fileKey?: string;
  status: KybDocStatus;
  uploadedAt: Date;
  verifiedAt?: Date;
  reviewerNotes?: string;
}

export type KybDocType = 'trade_license' | 'articles_of_incorporation' | 'bank_statement' | 'financial_statement';
export type KybDocStatus = 'pending' | 'verified' | 'rejected';

export interface KybReviewAction {
  status: Extract<KybStatus, 'approved' | 'rejected' | 'needs_info'>;
  notes?: string;
  reviewerId: string;
}
