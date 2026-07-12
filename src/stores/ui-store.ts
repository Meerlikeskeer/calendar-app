import { create } from "zustand"

type ActivePanel = "none" | "settings"

type UiState = {
  activePanel: ActivePanel
  isSidebarOpen: boolean
  setActivePanel: (activePanel: ActivePanel) => void
  setSidebarOpen: (isSidebarOpen: boolean) => void
  toggleSidebar: () => void
}

export const useUiStore = create<UiState>((set) => ({
  activePanel: "none",
  isSidebarOpen: false,
  setActivePanel: (activePanel) => set({ activePanel }),
  setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),
  toggleSidebar: () =>
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
}))
