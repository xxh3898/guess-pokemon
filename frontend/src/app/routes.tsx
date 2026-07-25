import { createBrowserRouter, type RouteObject } from "react-router";

import {
  AnonymousOnlyRoute,
  AuthenticatedRoute,
} from "../features/auth/AuthRouteGuards";
import { LoginPage } from "../features/auth/LoginPage";
import { SignupPage } from "../features/auth/SignupPage";
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
    ],
  },
  {
    path: "*",
    Component: NotFoundPage,
  },
];

export const router = createBrowserRouter(routes);
