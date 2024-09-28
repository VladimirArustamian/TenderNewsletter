npm install @google-cloud/storage google-auth-library zod

# .env.local
GCP_CLIENT_EMAIL=your-google-cloud-client-email
GCP_PRIVATE_KEY=your-google-cloud-private-key
GCP_PROJECT_ID=your-google-cloud-project-id
CLOUD_FUNCTION_URL=https://your-cloud-function-url

export interface ReturnActionGenericType<T> {
    status: number;
    data?: T;
    error?: string;
}

import { z } from "zod";

export const tenderSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    // Add other fields as necessary
});

export type Tender = z.infer<typeof tenderSchema>;

export interface SearchRequestData {
    query: string;
    // Add other search parameters as needed
}

export interface TenderFile {
    fileData: {
        fileUri: string;
        mimeType: string;
    };
}

export const googleCredentialsObject = {
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    project_id: process.env.GCP_PROJECT_ID,
};

"use server";

import { googleCredentialsObject } from "./gcpCredentials";
import { ReturnActionGenericType } from "./types/returnTypes";
import {
    SearchRequestData,
    Tender,
    tenderSchema,
} from "./types/searchTypes";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import { GaxiosResponse } from "gaxios";

const auth = new GoogleAuth({ credentials: googleCredentialsObject });

export interface SearchResponseType {
    status: number;
    error?: string;
    data?: Tender[];
}

export async function callRemoteCloudFunction<T = any>(
    url: string,
    method: "GET" | "POST",
    data?: any | undefined,
): Promise<ReturnActionGenericType<T>> {
    try {
        const targetAudience = url;
        const client = await auth.getIdTokenClient(targetAudience);

        const response: GaxiosResponse<T> = await client.request<T>({
            url,
            method,
            data,
        });
        return response;
    } catch (error) {
        if (error instanceof Error) {
            console.error(
                `Failed to fetch data. Error message: ${error.message}`,
            );
            return { status: 500, error: "Failed to fetch data" };
        }
        throw error;
    }
}

export async function callRemoteSearch(
    url: string,
    data: SearchRequestData,
): Promise<SearchResponseType> {
    const response = await callRemoteCloudFunction<any>(url, "POST", data);

    if (response.status === 204) {
        return {
            status: 204,
            data: [],
        };
    }
    if (response.status === 200) {
        const resultsUnTyped = JSON.parse(response.data as string);
        const { success, data, error } = z
            .array(tenderSchema)
            .safeParse(resultsUnTyped);
        if (!success) {
            return { error: error.issues[0].message, status: 500 };
        }
        return {
            status: 200,
            data: data,
        };
    }

    return {
        status: response.status ?? 500,
        error: response.error ?? "Unknown error",
    };
}


import type { NextApiRequest, NextApiResponse } from 'next';
import { callRemoteSearch, SearchRequestData, SearchResponseType } from '@/app/utils/gcpWrapper';

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<SearchResponseType>
) {
    if (req.method !== 'POST') {
        res.status(405).json({ status: 405, error: 'Method Not Allowed' });
        return;
    }

    const searchData: SearchRequestData = req.body;

    const url = process.env.CLOUD_FUNCTION_URL!; // Ensure this environment variable is set

    try {
        const result = await callRemoteSearch(url, searchData);
        res.status(result.status).json(result);
    } catch (error) {
        res.status(500).json({ status: 500, error: 'Internal Server Error' });
    }
}

