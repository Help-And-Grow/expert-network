import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    domains: [],
    message: "No fixed domain taxonomy is configured. Match experts by query, bio, and services.",
  });
}
