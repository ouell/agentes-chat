import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { ChatPrefs } from "@agenteschat/client/lib/chat-look";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { CHANNEL_BOARD_NARROW_QUERY, CHANNEL_BOARD_WIDE_QUERY } from "@/hooks/useMembersColumn";
import { STORAGE_KEYS } from "@/lib/storage";
import {
  ATLAS_ID,
  createFakeApi,
  ENG_ID,
  type FakeState,
  fakeDashboardsOf,
  ORG_ID,
  seedState,
  withChatPrefs,
} from "./fake-api";
import type { FakeDashboards } from "./fakes/dashboards";
import { renderApp, screen, settle } from "./render";

let media: { mockRestore: () => void } | null = null;
/** Only `query` matches. */
const widthIs = (query: string) => {
  media = spyOn(window, "matchMedia").mockImplementation(
    (q: string) =>
      ({
        matches: q === query,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
};

afterEach(() => {
  cleanup();
  media?.mockRestore();
  media = null;
  localStorage.clear();
});

const KEY = `${STORAGE_KEYS.channelBoard}.u-walter.${ORG_ID}`;
const click = (el: Element) => act(async () => fireEvent.click(el));
const toggle = () => screen().queryByRole("button", { name: "Painel do canal" });
const column = () => screen().queryByRole("complementary", { name: "Painel de #eng" });
/** This fork keeps the board per person, in `chatPrefs.channelBoards`. */
const link = (state: FakeState, id: string | null) =>
  withChatPrefs(state, { channelBoards: id ? { [ENG_ID]: id } : {} });
const saved = (state: FakeState) =>
  state.calls.filter((c) => c.method === "orgs.setChatPrefs").map((c) => (c.args[1] as ChatPrefs).channelBoards);

/** #eng with the board "Vendas" (one widget) linked, unless `prepare` changes it. */
async function open(prepare?: (state: FakeState, fake: FakeDashboards) => void) {
  const state = seedState();
  const api = createFakeApi(state);
  const fake = fakeDashboardsOf.get(api) as FakeDashboards;
  fake.addBoard({ id: "dash-v", title: "Vendas", audience: "workspace" });
  fake.addWidget("dash-v", { agentId: ATLAS_ID, title: "Receita hoje", layout: { position: 0, w: 1, h: 1 } });
  link(state, "dash-v");
  prepare?.(state, fake);
  const view = await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
  await settle(8);
  await act(async () => view.sockets.last().open());
  return { state, fake, ...view };
}

describe("a channel's dashboard (ADR 0135 §21)", () => {
  test("docked on a wide window, before the members, with the board's grid; closing it is remembered", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    await open();
    const side = column() as HTMLElement;
    expect(side).toBeTruthy();
    expect(side.classList.contains("members-side")).toBe(true);
    expect(side.closest(".channel__body")).toBeTruthy();
    expect(within(side).getByRole("link", { name: "Vendas" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/dashboards/dash-v`,
    );
    expect(side.textContent).toContain("Receita hoje");
    // The board's own controls, for whoever edits it.
    expect(within(side).getByRole("group", { name: "Vendas" })).toBeTruthy();
    expect(toggle()?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle()?.getAttribute("title")).toBe("Esconder painel");
    await click(toggle() as HTMLElement);
    expect(column()).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("0");
    cleanup();
    await open();
    expect(column()).toBeNull();
    expect(toggle()?.getAttribute("aria-pressed")).toBe("false");
  });

  test("on a narrower window it floats over the chat, opened from the header", async () => {
    widthIs(CHANNEL_BOARD_NARROW_QUERY);
    await open();
    expect(column()).toBeNull();
    await click(toggle() as HTMLElement);
    await settle(3);
    const panel = column() as HTMLElement;
    expect(panel.classList.contains("channel-board--float")).toBe(true);
    expect(panel.closest(".channel__body")).toBeNull();
    await click(within(panel).getByRole("button", { name: "Fechar" }));
    await settle(3);
    expect(column()).toBeNull();
  });

  test("a board deleted, or no longer shown to me, asks for another: never its title or widgets", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    await open((_state, fake) => {
      fake.boards = fake.boards.filter((b) => b.id !== "dash-v");
    });
    const side = column() as HTMLElement;
    expect(side.textContent).toContain("Nenhum painel aqui ainda");
    expect(side.textContent).not.toContain("Não compartilhado com você");
    expect(side.textContent).not.toContain("Receita hoje");
  });

  test("no board: the button opens the picker; picking keeps it for me", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    const { state } = await open((s) => {
      link(s, null);
    });
    expect(column()).toBeNull();
    await click(toggle() as HTMLElement);
    await settle(4);
    const panel = column() as HTMLElement;
    expect(panel.textContent).toContain("Nenhum painel aqui ainda");
    const picker = within(panel).getByRole("combobox", { name: "Painel" });
    picker.focus();
    await act(async () => fireEvent.keyDown(picker, { key: "Enter" }));
    await click(screen().getByRole("option", { name: "Vendas" }));
    await settle(6);
    expect(saved(state)).toEqual([{ [ENG_ID]: "dash-v" }]);
    const docked = column() as HTMLElement;
    expect(docked.classList.contains("channel-board--float")).toBe(false);
    expect(within(docked).getByRole("link", { name: "Vendas" })).toBeTruthy();
  });

  test("a manager takes it off the channel from its menu", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    const { state } = await open();
    const trigger = within(column() as HTMLElement).getByRole("button", { name: "Opções do painel" });
    trigger.focus();
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.keyUp(trigger, { key: "Enter" });
    });
    await settle(1);
    await click(within(screen().getByRole("menu")).getByRole("menuitem", { name: "Tirar do canal" }));
    await settle(6);
    expect(saved(state)).toEqual([{}]);
    expect(column()).toBeNull();
  });

  test("a widget opens in its panel, kept in the address (`?widget=`)", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    const { router } = await open();
    const card = within(column() as HTMLElement).getByText("Receita hoje");
    await click(card);
    await settle(6);
    expect((router.state.location.search as { widget?: string }).widget).toBeTruthy();
  });

  test("floating, a widget's panel takes the board's place and closing it brings the board back", async () => {
    widthIs(CHANNEL_BOARD_NARROW_QUERY);
    const { router } = await open();
    await click(toggle() as HTMLElement);
    await settle(3);
    await click(within(column() as HTMLElement).getByText("Receita hoje"));
    await settle(6);
    expect((router.state.location.search as { widget?: string }).widget).toBeTruthy();
    expect(column()).toBeNull();
    expect(document.querySelectorAll(".thread-panel").length).toBe(0);
    const dialog = screen().getByRole("dialog");
    await click(within(dialog).getAllByRole("button", { name: "Fechar" })[0] as HTMLElement);
    await settle(6);
    expect(column()?.classList.contains("channel-board--float")).toBe(true);
  });
});
