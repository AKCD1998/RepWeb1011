import { Router } from "express";
import { createDispense } from "../controllers/dispenseController.js";
import { requireBranchAccess, requireRole, verifyToken } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post(
  "/",
  verifyToken,
  requireRole("ADMIN", "PHARMACIST"),
  requireBranchAccess({
    matchBodyFields: ["branchCode"],
    forceBodyFields: ["branchCode"],
  }),
  asyncHandler(createDispense)
);

export default router;
