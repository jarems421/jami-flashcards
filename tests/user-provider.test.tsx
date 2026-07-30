import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "firebase/auth";
import { describe, expect, it } from "vitest";
import UserProvider, { useUser } from "@/components/providers/UserProvider";

function UserUid() {
  const { user } = useUser();
  return createElement("span", null, user.uid);
}

describe("UserProvider", () => {
  it("provides the authenticated user supplied by the dashboard gate", () => {
    const user = { uid: "alice" } as User;

    const output = renderToStaticMarkup(
      <UserProvider user={user}>
        <UserUid />
      </UserProvider>,
    );

    expect(output).toContain("alice");
  });

  it("rejects consumers outside the provider boundary", () => {
    expect(() => renderToStaticMarkup(createElement(UserUid))).toThrow(
      "useUser() must be used inside <UserProvider>",
    );
  });
});
