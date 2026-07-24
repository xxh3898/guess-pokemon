import { createBrowserRouter, type RouteObject } from "react-router";

import { HomePage } from "../pages/HomePage";
import { NotFoundPage } from "../pages/NotFoundPage";

export const routes: RouteObject[] = [
  {
    path: "/",
    Component: HomePage,
  },
  {
    path: "*",
    Component: NotFoundPage,
  },
];

export const router = createBrowserRouter(routes);
