import { Router } from "express";
import { executeSql } from "../controllers/adminController.js";
import { requireRole, verifyToken } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/sql/execute", verifyToken, requireRole("ADMIN"), asyncHandler(executeSql));

export default router;
