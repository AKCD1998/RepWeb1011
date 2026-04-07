import { Router } from "express";
import { executeSql } from "../controllers/adminController.js";
import {
  createIncidentReport,
  getIncidentReportById,
  listIncidentReports,
  updateIncidentReportStatus,
} from "../controllers/adminIncidentsController.js";
import { requireRole, verifyToken } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/incidents", verifyToken, requireRole("ADMIN"), asyncHandler(listIncidentReports));
router.get("/incidents/:id", verifyToken, requireRole("ADMIN"), asyncHandler(getIncidentReportById));
router.post("/incidents", verifyToken, requireRole("ADMIN"), asyncHandler(createIncidentReport));
router.patch(
  "/incidents/:id/status",
  verifyToken,
  requireRole("ADMIN"),
  asyncHandler(updateIncidentReportStatus)
);
router.post("/sql/execute", verifyToken, requireRole("ADMIN"), asyncHandler(executeSql));

export default router;
