export interface CreateManagerDto {
  email: string;
  password: string;
  displayName: string;
  role?: 'ADMIN' | 'MANAGER';
}

export interface UpdateManagerDto {
  displayName?: string;
}

export interface UpdateManagerStatusDto {
  enabled: boolean;
}

export interface UpdateManagerRoleDto {
  role: 'ADMIN' | 'MANAGER';
}
