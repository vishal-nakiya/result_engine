import { Router } from "express";
import { candidatesRouter } from "./candidates.routes.js";
import { uploadRouter } from "./upload.routes.js";
import { rulesRouter } from "./rules.routes.js";
import { processRouter } from "./process.routes.js";
import { dashboardRouter } from "./dashboard.routes.js";
import { logsRouter } from "./logs.routes.js";
import { allocationRouter } from "./allocation.routes.js";
import { stateDistrictsRouter } from "./state-districts.routes.js";
import { vacancyRouter } from "./vacancy.routes.js";

export const apiRouter = Router();

apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/candidates", candidatesRouter);
apiRouter.use("/upload", uploadRouter);
apiRouter.use("/rules", rulesRouter);
apiRouter.use("/process", processRouter);
apiRouter.use("/logs", logsRouter);
apiRouter.use("/allocation", allocationRouter);
apiRouter.use("/state-districts", stateDistrictsRouter);
apiRouter.use("/vacancy", vacancyRouter);

