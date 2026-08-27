"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import type { AdminUser } from "@/types/users";

interface UsersDialogsValue {
  // "new" opens UserModal in create mode; an AdminUser opens it in edit mode
  // for that user; null keeps it closed.
  modalTarget: AdminUser | "new" | null;
  setModalTarget: (target: AdminUser | "new" | null) => void;
  deletingUser: AdminUser | null;
  setDeletingUser: (user: AdminUser | null) => void;
}

const UsersDialogsContext = createContext<UsersDialogsValue | null>(null);

export function UsersDialogsProvider({ children }: { children: ReactNode }) {
  const [modalTarget, setModalTarget] = useState<AdminUser | "new" | null>(
    null,
  );
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);

  return (
    <UsersDialogsContext.Provider
      value={{ modalTarget, setModalTarget, deletingUser, setDeletingUser }}
    >
      {children}
    </UsersDialogsContext.Provider>
  );
}

export function useUsersDialogs() {
  const context = useContext(UsersDialogsContext);
  if (!context) {
    throw new Error("useUsersDialogs must be used within UsersDialogsProvider");
  }
  return context;
}
