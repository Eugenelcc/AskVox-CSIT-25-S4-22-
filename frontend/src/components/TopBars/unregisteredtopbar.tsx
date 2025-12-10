import { type FC } from "react";
import "./UnregisteredTopBar.css";
import AskVoxLogo from "./AskVox.png"; 

const UnregisteredTopBar: FC = () => {
  const goToSignup = () => {
    window.location.href = "/createaccount"; 
  };

  const goToLogin = () => {
    window.location.href = "/login";
  };

  return (
    <header className="uv-topbar">
      <div className="uv-topbar-left">
        <img src={AskVoxLogo} alt="AskVox" className="uv-logo" />
      </div>

      <div className="uv-topbar-right">
         <button className="uv-top-btn uv-top-btn-outline" onClick={goToSignup}>
          Create account for free
        </button>
        <button className="uv-top-btn uv-top-btn-outline" onClick={goToLogin}>
          Log in
        </button>
      </div>
    </header>
  );
};

export default UnregisteredTopBar;
