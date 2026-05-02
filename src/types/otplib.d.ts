declare module 'otplib' {
  export const authenticator: {
    generateSecret(): string;
    keyuri(user: string, service: string, secret: string): string;
    verify(options: { token: string; secret: string }): boolean;
  };
}
