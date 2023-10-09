"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/client";
import { uploadFiles } from "@/utils/uploadthing";
import {
  Alert,
  Box,
  Button,
  Group,
  Modal,
  rem,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { Dropzone, DropzoneReject, IMAGE_MIME_TYPE } from "@mantine/dropzone";
import { hasLength, useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconCalendar,
  IconCheck,
  IconLetterCase,
  IconX,
} from "@tabler/icons-react";

import type { RouterOutputs } from "@eboto-mo/api";
import { isElectionOngoing } from "@eboto-mo/constants";
import type { Publicity } from "@eboto-mo/db/schema";
import { publicity } from "@eboto-mo/db/schema";

export default function DashboardSettings({
  election,
}: {
  election: RouterOutputs["election"]["getElectionBySlug"];
}) {
  const getElectionBySlugQuery = api.election.getElectionBySlug.useQuery(
    {
      slug: election.slug,
    },
    {
      initialData: election,
    },
  );
  const context = api.useContext();
  const [isUpdating, setIsUpdating] = useState(false);
  const router = useRouter();
  const openRef = useRef<() => void>(null);
  const editElectionMutation = api.election.editElection.useMutation({
    onSuccess: async () => {
      if (form.values.newSlug !== election.slug) {
        router.push(`/dashboard/${form.values.newSlug}/settings`);
      }
      if (form.values.name !== election.name) {
        await context.election.getAllMyElections.invalidate();
      }

      notifications.show({
        title: "Election settings updated.",
        icon: <IconCheck size="1.1rem" />,
        message: "Your changes have been saved.",
        autoClose: 3000,
      });

      form.resetDirty();
      form.setValues({
        newLogo: null,
      });

      await getElectionBySlugQuery.refetch();
    },
    onError: (error) => {
      notifications.show({
        title: "Error",
        message: error.message,
        color: "red",
        autoClose: 3000,
      });
    },
  });
  const [opened, { open, close }] = useDisclosure(false);

  const form = useForm<{
    name: string;
    newSlug: string;
    description: string;
    // voter_domain: string | null;
    start_date: Date;
    end_date: Date;
    publicity: Publicity;
    oldLogo: string | null;
    newLogo: File | null;
  }>({
    initialValues: {
      name: getElectionBySlugQuery.data.name,
      newSlug: getElectionBySlugQuery.data.slug,
      description: getElectionBySlugQuery.data.description ?? "",
      // voter_domain: null,
      start_date: getElectionBySlugQuery.data.start_date,
      end_date: getElectionBySlugQuery.data.end_date,
      publicity: getElectionBySlugQuery.data.publicity,
      oldLogo: getElectionBySlugQuery.data.logo,
      newLogo: null,
    },
    validateInputOnBlur: true,
    clearInputErrorOnChange: true,
    transformValues: (values) => ({
      ...values,
      start_date: new Date(values.start_date.setSeconds(0, 0)),
      end_date: new Date(values.end_date.setSeconds(0, 0)),
    }),
    validate: {
      name: hasLength(
        { min: 3 },
        "Election name must be at least 3 characters",
      ),
      newSlug: (value) => {
        if (!value) {
          return "Please enter an election slug";
        }
        if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value)) {
          return "Election slug must be alphanumeric and can contain dashes";
        }
        if (value.length < 3 || value.length > 24) {
          return "Election slug must be between 3 and 24 characters";
        }
      },
      start_date: (value, values) => {
        if (!value) {
          return "Please enter an election start date";
        }
        if (values.end_date && value.getTime() >= values.end_date.getTime()) {
          return "Start date must be before end date";
        }
      },
      end_date: (value, values) => {
        if (!value) {
          return "Please enter an election end date";
        }
        if (
          values.start_date &&
          value.getTime() <= values.start_date.getTime()
        ) {
          return "End date must be after start date";
        }
      },
      publicity: (value) => {
        if (!value) {
          return "Please select an election publicity";
        }
      },
      // voter_domain: (value) => {
      //   if (
      //     value &&
      //     !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/.test(
      //       value
      //     )
      //   ) {
      //     return "Voter domain must be alphanumeric and can contain dashes";
      //   }

      //   if (value && value.includes(" ")) {
      //     return "Voter domain cannot contain spaces";
      //   }

      //   if (value && value.includes("gmail.com")) {
      //     return "Voter domain cannot be gmail.com";
      //   }
      // },
    },
  });

  const deleteForm = useForm({
    initialValues: {
      name: "",
    },
    validateInputOnBlur: true,
    clearInputErrorOnChange: true,
    validate: {
      name: (value) => {
        if (value !== election.name) {
          return "Election name does not match";
        }
      },
    },
  });

  const deleteElectionMutation = api.election.deleteElection.useMutation({
    onSuccess: () => {
      router.push("/dashboard");
      notifications.show({
        title: "Election deleted.",
        message: "Your election has been deleted.",
        icon: <IconCheck size="1.1rem" />,
        autoClose: 3000,
      });
      close();
    },
    onError: (error) => {
      notifications.show({
        title: "Error",
        message: error.message,
        color: "red",
        autoClose: 3000,
      });
    },
  });

  return (
    <Box h="100%">
      <Modal
        opened={opened || deleteElectionMutation.isLoading}
        onClose={close}
        title={<Text fw={600}>Delete election</Text>}
      >
        <form
          onSubmit={deleteForm.onSubmit(() =>
            deleteElectionMutation.mutate({
              election_id: election.id,
            }),
          )}
        >
          <Stack gap="sm">
            <TextInput
              data-autofocus
              label="Election name"
              withAsterisk
              required
              placeholder="Enter election name to confirm deletion"
              {...deleteForm.getInputProps("name")}
              leftSection={<IconLetterCase size="1rem" />}
              description={
                <Text
                  style={{
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  Please type{" "}
                  <Text fw="bold" component="span">
                    {election.name}
                  </Text>{" "}
                  to confirm deletion. This action cannot be undone.
                </Text>
              }
            />

            <Group justify="right" gap="xs">
              <Button
                variant="default"
                mr={2}
                onClick={close}
                disabled={deleteElectionMutation.isLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!deleteForm.isValid()}
                loading={deleteElectionMutation.isLoading}
              >
                Confirm Delete
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <form
        onSubmit={form.onSubmit(
          (values) =>
            void (async () => {
              setIsUpdating(true);
              await editElectionMutation.mutateAsync({
                id: election.id,
                name: values.name,
                newSlug: values.newSlug,
                description: values.description,
                oldSlug: election.slug,
                // voter_domain: values.voter_domain,
                start_date: values.start_date,
                end_date: values.end_date,
                publicity: values.publicity,
                // logo: null,
                logo: values.newLogo
                  ? (
                      await uploadFiles({
                        endpoint: "electionLogoUploader",
                        files: [
                          new File(
                            [values.newLogo],
                            election.id + "_logo_" + values.newLogo.name,
                            {
                              type: values.newLogo.type,
                            },
                          ),
                        ],
                        input: {
                          election_id: election.id,
                        },
                      })
                    )?.[0]?.url ?? null
                  : values.oldLogo,
              });
              setIsUpdating(false);
            })(),
        )}
      >
        <Stack gap="sm">
          <TextInput
            label="Election name"
            withAsterisk
            required
            placeholder="Enter election name"
            {...form.getInputProps("name")}
            leftSection={<IconLetterCase size="1rem" />}
            disabled={isUpdating}
          />

          <TextInput
            label="Election slug"
            description={
              <>
                This will be used as the URL for your election
                <br />
                eboto-mo.com/{form.values.newSlug || "election-slug"}
              </>
            }
            withAsterisk
            required
            placeholder="Enter election slug"
            {...form.getInputProps("newSlug")}
            leftSection={<IconLetterCase size="1rem" />}
            error={
              form.errors.slug ??
              (editElectionMutation.error?.data?.code === "CONFLICT" &&
                editElectionMutation.error?.message)
            }
            disabled={isUpdating}
          />

          <Textarea
            label="Election description"
            description="This will be shown on the election page."
            placeholder="Enter election description"
            {...form.getInputProps("description")}
            leftSection={<IconLetterCase size="1rem" />}
            minRows={3}
            maxRows={8}
            autosize
            error={
              form.errors.description ??
              (editElectionMutation.error?.data?.code === "CONFLICT" &&
                editElectionMutation.error?.message)
            }
            disabled={isUpdating}
          />

          {/* <TextInput
                    label="Election voter's domain"
                    description={`This will be used to restrict voters to a specific domain. For example, if you set this to "cvsu.edu.ph", only voters with an email address ending with "cvsu.edu.ph" will be able to vote. This is good for school elections (such as CSG Election).`}
                    placeholder="cvsu.edu.ph"
                    {...form.getInputProps("voter_domain")}
                    leftSection={<IconAt size="1rem" />}
                    error={
                      form.errors.voter_domain ||
                      (updateElectionMutation.error?.data?.code ===
                        "CONFLICT" &&
                        updateElectionMutation.error?.message)
                    }
                    disabled={
                      loading ||
                      isElectionOngoing({
                        election: election.data,
                        withTime: false,
                      })
                    }
                  /> */}

          <DateTimePicker
            valueFormat="MMMM DD, YYYY (dddd) hh:mm A"
            label="Election start date"
            placeholder="Enter election start date"
            description="You can't change the election date once the election has started."
            required
            clearable
            withAsterisk
            popoverProps={{
              withinPortal: true,
              position: "bottom",
            }}
            minDate={new Date(new Date().setDate(new Date().getDate() + 1))}
            firstDayOfWeek={0}
            {...form.getInputProps("start_date")}
            leftSection={<IconCalendar size="1rem" />}
            disabled={
              isUpdating ||
              isElectionOngoing({
                election: getElectionBySlugQuery.data,
              })
            }
          />
          <DateTimePicker
            valueFormat="MMMM DD, YYYY (dddd) hh:mm A"
            label="Election end date"
            placeholder="Enter election end date"
            description="You can't change the election date once the election has started."
            required
            withAsterisk
            clearable
            popoverProps={{
              withinPortal: true,
              position: "bottom",
            }}
            minDate={
              form.values.start_date ||
              new Date(new Date().setDate(new Date().getDate() + 1))
            }
            firstDayOfWeek={0}
            {...form.getInputProps("end_date")}
            leftSection={<IconCalendar size="1rem" />}
            disabled={
              isUpdating ||
              isElectionOngoing({
                election: getElectionBySlugQuery.data,
              })
            }
          />

          <Select
            label="Election publicity"
            description="Private elections are only visible to you and the other commissioners. Voter elections are visible to voters you invite. Public elections are visible to everyone."
            withAsterisk
            comboboxProps={{
              withinPortal: true,
            }}
            required
            {...form.getInputProps("publicity")}
            data={publicity.map((p) => ({
              value: p,
              label: p.charAt(0) + p.slice(1).toLowerCase(),
            }))}
            disabled={isUpdating}
          />

          <Box>
            <Text size="sm" fw={500} component="label" htmlFor="logo" inline>
              Election logo
            </Text>
            <Stack gap="xs">
              <Dropzone
                id="logo"
                onDrop={(files) => {
                  if (!files[0]) return;
                  form.setFieldValue("newLogo", files[0]);
                }}
                openRef={openRef}
                maxSize={5 * 1024 ** 2}
                accept={IMAGE_MIME_TYPE}
                multiple={false}
                loading={isUpdating}
              >
                <Group
                  justify="center"
                  gap="xl"
                  style={{ minHeight: rem(140), pointerEvents: "none" }}
                >
                  {form.values.newLogo ? (
                    <Box
                      pos="relative"
                      style={() => ({
                        width: rem(120),
                        height: rem(120),

                        // [theme.fn.smallerThan("sm")]: {
                        //   width: rem(180),
                        //   height: rem(180),
                        // },
                      })}
                    >
                      <Image
                        src={URL.createObjectURL(form.values.newLogo)}
                        alt="Logo"
                        fill
                        sizes="100%"
                        priority
                        style={{ objectFit: "cover" }}
                      />
                    </Box>
                  ) : form.values.oldLogo ? (
                    <Group>
                      <Box
                        pos="relative"
                        style={() => ({
                          width: rem(120),
                          height: rem(120),

                          // [theme.fn.smallerThan("sm")]: {
                          //   width: rem(180),
                          //   height: rem(180),
                          // },
                        })}
                      >
                        <Image
                          src={form.values.oldLogo}
                          alt="Logo"
                          fill
                          sizes="100%"
                          priority
                          style={{ objectFit: "cover" }}
                        />
                      </Box>
                      <Text>Current logo</Text>
                    </Group>
                  ) : (
                    <Box>
                      <Text size="xl" inline ta="center">
                        Drag image here or click to select image
                      </Text>
                      <Text size="sm" c="dimmed" inline mt={7} ta="center">
                        Attach a logo to your election. Max file size is 5MB.
                      </Text>
                    </Box>
                  )}
                  <DropzoneReject>
                    <IconX size="3.2rem" stroke={1.5} />
                  </DropzoneReject>
                </Group>
              </Dropzone>
              <Group grow>
                <Button
                  variant="light"
                  onClick={() => {
                    form.setValues({
                      ...form.values,
                      oldLogo: election.logo,
                      newLogo: null,
                    });
                  }}
                  disabled={
                    (form.values.oldLogo === election.logo &&
                      form.values.newLogo === null) ||
                    isUpdating
                  }
                >
                  Reset logo
                </Button>
                <Button
                  color="red"
                  variant="light"
                  onClick={() => {
                    form.setValues({ oldLogo: null, newLogo: null });
                  }}
                  disabled={
                    (!form.values.oldLogo && !form.values.newLogo) || isUpdating
                  }
                >
                  Delete logo
                </Button>
              </Group>
            </Stack>
          </Box>

          {editElectionMutation.isError && (
            <Alert
              icon={<IconAlertCircle size="1rem" />}
              title="Error"
              color="red"
            >
              {editElectionMutation.error.message}
            </Alert>
          )}

          <Group justify="space-between">
            <Button
              type="submit"
              loading={isUpdating}
              disabled={!form.isDirty() || !form.isValid()}
              hiddenFrom="sm"
            >
              Update
            </Button>
            <Button
              type="submit"
              loading={isUpdating}
              disabled={!form.isDirty() || !form.isValid()}
              visibleFrom="sm"
            >
              Update election
            </Button>
            <Button
              variant="outline"
              color="red"
              onClick={open}
              disabled={isUpdating}
              // style={(theme) => ({
              //   [theme.fn.smallerThan("xs")]: {
              //     display: "none",
              //   },
              // })}
            >
              Delete election
            </Button>
          </Group>
        </Stack>
      </form>
    </Box>
  );
}