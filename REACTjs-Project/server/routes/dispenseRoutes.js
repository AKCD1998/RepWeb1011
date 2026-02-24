import { Router } from "express";
import { createDispense } from "../controllers/dispenseController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/", asyncHandler(createDispense));

export default router;
