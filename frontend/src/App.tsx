import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import RequireAuth from "./RequireAuth";
import Login from "./Login";
import Register from "./Register";
import HomeScreen from "./HomeScreen";
import SettingsScreen from "./SettingsScreen";
import TreeView from "./TreeView";
import InviteRedeem from "./InviteRedeem";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/invite/:id" element={<InviteRedeem />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <HomeScreen />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsScreen />
            </RequireAuth>
          }
        />
        <Route
          path="/tree/:treeId"
          element={
            <RequireAuth>
              <TreeView />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
