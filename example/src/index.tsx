import { render } from "react-dom";

import Canvas from "./Canvas";

const rootElement = document.getElementById("root");
render(<Canvas canvasHeight={250} canvasWidth={500} />, rootElement);
