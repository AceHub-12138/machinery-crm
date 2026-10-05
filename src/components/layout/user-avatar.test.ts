import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserAvatar, getUserAvatarColor, getUserInitial } from "./user-avatar";

describe("initial-based user avatar", () => {
  it("uses the first Unicode character of the display name", () => {
    expect(getUserInitial(" 张三 ", "zhang@example.com")).toBe("张");
    expect(getUserInitial("", "sales@example.com")).toBe("S");
  });

  it("maps the same user id to a stable presentation color", () => {
    expect(getUserAvatarColor("user-42")).toBe(getUserAvatarColor("user-42"));
    expect(getUserAvatarColor("user-42")).toMatch(/^bg-/);
  });

  it("renders a protected lazy image when an avatar path is available", () => {
    const markup = renderToStaticMarkup(
      createElement(UserAvatar, {
        avatarPath: "/uploads/avatars/avatar.webp",
        name: "张三",
        userId: "user-42",
      }),
    );

    expect(markup).toContain('src="/api/uploads/avatars/avatar.webp"');
    expect(markup).toContain('alt="张三的头像"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).not.toContain(">张</span>");
  });
});
