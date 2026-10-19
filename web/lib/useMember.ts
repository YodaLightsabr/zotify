"use client";

import { useEffect } from "react";
import { goToLogin } from "./api";
import { useUser } from "./user";

/** For pages only approved members can see: sends anyone else to sign in or to the beta screen. Returns the user once they're allowed in */
export function useMember(path: string) {
    const { user } = useUser();

    useEffect(() => {
        if (user === null) goToLogin(path);
        else if (user && !user.approved) goToLogin(path, true);
    }, [user, path]);

    return user?.approved ? user : null;
}
