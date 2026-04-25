/**
 * Shape of `req.user` after authentication.
 */
export interface RequestUser {
  /** Felo internal user id (uuid) */
  id: string;
  /** Firebase uid (sub claim) */
  firebaseUid: string;
  /** Email at the time the JWT was issued */
  email: string;
}
