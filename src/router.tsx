import { createBrowserRouter } from "react-router"

import { HomeRoute } from "@/routes/home"
import { RootLayout } from "@/routes/root"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomeRoute />,
      },
    ],
  },
])
