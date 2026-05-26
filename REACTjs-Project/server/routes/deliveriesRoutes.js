import { Router } from "express";
import { returnDelivery } from "../controllers/deliveriesController.js";
import { requireRole, verifyToken } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post(
  "/return",
  verifyToken,
  requireRole("ADMIN", "PHARMACIST"),
  asyncHandler(returnDelivery)
);

export default router;
