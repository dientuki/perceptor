"use client";
import type React from "react";
import { createContext, useContext } from "react";

const DateFormatContext = createContext<boolean>(false);

export const useDateMonthFirst = () => useContext(DateFormatContext);

export const DateFormatProvider: React.FC<{
  monthFirst: boolean;
  children: React.ReactNode;
}> = ({ monthFirst, children }) => (
  <DateFormatContext.Provider value={monthFirst}>
    {children}
  </DateFormatContext.Provider>
);
