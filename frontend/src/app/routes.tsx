import { createBrowserRouter, type RouteObject } from "react-router";

import {
  AnonymousOnlyRoute,
  AuthenticatedRoute,
} from "../features/auth/AuthRouteGuards";
import { LoginPage } from "../features/auth/LoginPage";
import { SignupPage } from "../features/auth/SignupPage";
import { HistoryDetailPage } from "../features/history/HistoryDetailPage";
import { HistoryListPage } from "../features/history/HistoryListPage";
import { RoomPage } from "../features/room/RoomPage";
import { HomePage } from "../pages/HomePage";
import { LobbyPage } from "../pages/LobbyPage";
import { NotFoundPage } from "../pages/NotFoundPage";

export const routes: RouteObject[] = [
  {
    path: "/",
    Component: HomePage,
  },
  {
    Component: AnonymousOnlyRoute,
    children: [
      {
        path: "/signup",
        Component: SignupPage,
      },
      {
        path: "/login",
        Component: LoginPage,
      },
    ],
  },
  {
    Component: AuthenticatedRoute,
    children: [
      {
        path: "/lobby",
        Component: LobbyPage,
      },
      {
        path: "/rooms/:roomCode",
        Component: RoomPage,
      },
      {
        path: "/history",
        Component: HistoryListPage,
      },
      {
        path: "/history/:gameId",
        Component: HistoryDetailPage,
      },
    ],
  },
  {
    path: "*",
    Component: NotFoundPage,
  },
];

export const router = createBrowserRouter(routes);
