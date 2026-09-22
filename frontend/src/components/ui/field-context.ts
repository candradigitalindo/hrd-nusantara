"use client";

import * as React from "react";

/**
 * id elemen teks label milik <Field>, supaya kontrol kustom seperti Select
 * (yang pemicunya tombol, bukan <select>) bisa merujuknya lewat aria-labelledby.
 */
export const KonteksIdLabel = React.createContext<string | undefined>(undefined);
export const useIdLabelField = () => React.useContext(KonteksIdLabel);
