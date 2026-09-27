export interface RegisterManagerDto {
  email: string;
  password: string;
  displayName: string;
  role?: 'ADMIN' | 'MANAGER';
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'ADMIN' | 'MANAGER';
}
